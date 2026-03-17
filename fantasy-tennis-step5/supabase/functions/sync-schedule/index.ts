// supabase/functions/sync-schedule/index.ts
//
// Sincronizza il calendario tornei ATP dall'API.
// Cron: ogni lunedì mattina alle 6:00 UTC
// Può anche essere invocata manualmente per il primo setup.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ApiTournament {
  id:         string
  name:       string
  start_date: string
  end_date:   string
  category?:  string   // 'Grand Slam' | 'ATP Masters 1000' | ...
  surface?:   string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const rapidApiKey = Deno.env.get('RAPIDAPI_KEY')!

  // Fetch ATP calendar for current year
  const year = new Date().getFullYear()
  const url  = `https://api-tennis.p.rapidapi.com/tournaments?type=ATP&season_id=${year}`

  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key':  rapidApiKey,
      'X-RapidAPI-Host': 'api-tennis.p.rapidapi.com',
    },
  })

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: `API error: ${res.status}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const json = await res.json()
  const all: ApiTournament[] = json.result ?? json.response ?? []

  // Filtra solo Slam e Masters 1000
  const relevant = all.filter(t => {
    const cat = (t.category ?? '').toLowerCase()
    return cat.includes('grand slam') || cat.includes('masters 1000') || cat.includes('masters1000')
  })

  let inserted = 0
  let skipped  = 0

  for (const t of relevant) {
    const type         = detectType(t.category ?? '')
    const total_rounds = type === 'slam' ? 7 : 6
    const name         = cleanName(t.name, new Date(t.start_date).getFullYear())

    if (!t.start_date || !t.end_date || !name) { skipped++; continue }

    // Upsert — non sovrascrivere status se già impostato
    const { data: existing } = await supabase
      .from('tournaments')
      .select('id, status')
      .eq('api_tournament_id', t.id)
      .maybeSingle()

    if (existing) {
      // Aggiorna solo i campi non critici (non il status)
      await supabase
        .from('tournaments')
        .update({ name, start_date: t.start_date, end_date: t.end_date })
        .eq('id', existing.id)
      skipped++
    } else {
      await supabase.from('tournaments').insert({
        name,
        type,
        start_date:        t.start_date,
        end_date:          t.end_date,
        total_rounds,
        status:            'upcoming',
        api_tournament_id: t.id,
      })
      inserted++
    }
  }

  return new Response(
    JSON.stringify({ inserted, skipped, total_found: relevant.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

function detectType(category: string): 'slam' | 'masters1000' {
  const c = category.toLowerCase()
  if (c.includes('grand slam')) return 'slam'
  return 'masters1000'
}

function cleanName(raw: string, year: number): string {
  // Normalizza nomi tipo "Australian Open 2026" o "AO 2026"
  const nameMap: Record<string, string> = {
    'australian open':  'Australian Open',
    'roland garros':    'Roland Garros',
    'french open':      'Roland Garros',
    'wimbledon':        'Wimbledon',
    'us open':          'US Open',
    'indian wells':     'Indian Wells Masters',
    'miami':            'Miami Open',
    'monte carlo':      'Monte-Carlo Masters',
    'monte-carlo':      'Monte-Carlo Masters',
    'madrid':           'Madrid Open',
    'rome':             'Italian Open',
    'italian open':     'Italian Open',
    'internazionali':   'Italian Open',
    'canada':           'Canadian Open',
    'montreal':         'Canadian Open',
    'toronto':          'Canadian Open',
    'cincinnati':       'Cincinnati Masters',
    'western & southern': 'Cincinnati Masters',
    'shanghai':         'Shanghai Masters',
    'paris':            'Paris Masters',
    'bercy':            'Paris Masters',
  }
  const lower = raw.toLowerCase()
  for (const [key, clean] of Object.entries(nameMap)) {
    if (lower.includes(key)) return `${clean} ${year}`
  }
  return `${raw} ${year}`
}

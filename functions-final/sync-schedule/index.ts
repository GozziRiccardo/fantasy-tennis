// supabase/functions/sync-schedule/index.ts
// Sincronizza il calendario tornei ATP dall'API.
// Cron: ogni lunedì alle 6:00 UTC

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ApiTournament {
  id:         string
  name:       string
  start_date: string
  end_date:   string
  category?:  string
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

  // Solo Slam e Masters 1000
  const relevant = all.filter(t => {
    const cat = (t.category ?? '').toLowerCase()
    return cat.includes('grand slam') || cat.includes('masters 1000') || cat.includes('masters1000')
  })

  let inserted = 0
  let skipped  = 0

  for (const t of relevant) {
    const type         = (t.category ?? '').toLowerCase().includes('grand slam') ? 'slam' : 'masters1000'
    const total_rounds = type === 'slam' ? 7 : 6
    const name         = cleanName(t.name, new Date(t.start_date).getFullYear())

    if (!t.start_date || !t.end_date || !name) { skipped++; continue }

    const { data: existing } = await supabase
      .from('tournaments')
      .select('id, status')
      .eq('api_tournament_id', t.id)
      .maybeSingle()

    if (existing) {
      // Non sovrascrivere lo status — aggiorna solo date e nome
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

function cleanName(raw: string, year: number): string {
  const nameMap: Record<string, string> = {
    'australian open':      'Australian Open',
    'roland garros':        'Roland Garros',
    'french open':          'Roland Garros',
    'wimbledon':            'Wimbledon',
    'us open':              'US Open',
    'indian wells':         'Indian Wells Masters',
    'miami':                'Miami Open',
    'monte carlo':          'Monte-Carlo Masters',
    'monte-carlo':          'Monte-Carlo Masters',
    'madrid':               'Madrid Open',
    'rome':                 'Italian Open',
    'italian open':         'Italian Open',
    'internazionali':       'Italian Open',
    'canada':               'Canadian Open',
    'montreal':             'Canadian Open',
    'toronto':              'Canadian Open',
    'cincinnati':           'Cincinnati Masters',
    'western & southern':   'Cincinnati Masters',
    'shanghai':             'Shanghai Masters',
    'paris':                'Paris Masters',
    'bercy':                'Paris Masters',
  }
  const lower = raw.toLowerCase()
  for (const [key, clean] of Object.entries(nameMap)) {
    if (lower.includes(key)) return `${clean} ${year}`
  }
  return `${raw} ${year}`
}

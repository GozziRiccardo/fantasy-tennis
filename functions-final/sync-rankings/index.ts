// supabase/functions/sync-rankings/index.ts
// Aggiorna ranking e prezzi top 100 ATP.
// Cron: ogni mattina alle 4:00 UTC

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const rapidApiKey = Deno.env.get('RAPIDAPI_KEY')!

  const url = 'https://tennisapi1.p.rapidapi.com/api/tennis/rankings/atp'
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key':  rapidApiKey,
      'X-RapidAPI-Host': 'tennisapi1.p.rapidapi.com',
    },
  })

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: `API error: ${res.status}`, url }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const json = await res.json()

  // Logga la struttura per debug (visibile in Dashboard → Functions → Logs)
  console.log('API response keys:', Object.keys(json))
  console.log('First item sample:', JSON.stringify((json.data ?? json.results ?? json.rankings ?? json)[0]))

  // tennisapi1 può restituire { data: [...] } oppure direttamente un array
  const players: any[] = json.data ?? json.results ?? json.rankings ?? json ?? []

  let updated = 0
  let skipped = 0

  for (const p of players) {
    // tennisapi1 usa nomi di campo diversi — proviamo tutti i pattern comuni
    const ranking = Number(
      p.ranking ?? p.rank ?? p.position ?? p.current_ranking
    )
    const name = (
      p.player?.name ??
      p.player?.full_name ??
      p.name ??
      p.full_name ??
      p.athlete?.name ??
      p.competitor?.name
    )
    const apiId = String(
      p.player?.id ??
      p.player_id ??
      p.id ??
      p.athlete?.id ??
      p.competitor?.id ??
      ranking
    )
    const price = Math.max(1, Math.ceil((100 - ranking) / 10))

    if (!name || !ranking || ranking > 100) { skipped++; continue }

    const { error } = await supabase.from('atp_players').upsert(
      { api_player_id: apiId, name, ranking, price, updated_at: new Date().toISOString() },
      { onConflict: 'api_player_id' },
    )

    if (error) {
      // Fallback: aggiorna per nome se l'upsert per api_player_id fallisce
      await supabase
        .from('atp_players')
        .update({ ranking, price, updated_at: new Date().toISOString() })
        .ilike('name', name)
      skipped++
    } else {
      updated++
    }
  }

  // Aggiorna moltiplicatori sulle picks non ancora bloccate
  await supabase.rpc('refresh_pick_multipliers')

  return new Response(
    JSON.stringify({ updated_players: updated, skipped, total: players.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

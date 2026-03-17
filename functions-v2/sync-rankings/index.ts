// supabase/functions/sync-rankings/index.ts
// Aggiorna ranking e prezzi top 100 ATP singolare maschile.
// API: tennisapi1 (SofaScore)
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
      JSON.stringify({ error: `API error: ${res.status}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const json = await res.json()
  const allPlayers: any[] = json.rankings ?? []

  // L'API restituisce ~500 voci (singolare + doppio + altro).
  // Filtriamo: solo rankingClass === 'team' (singolare maschile),
  // ranking tra 1 e 100, e un solo giocatore per posizione.
  const seenRankings = new Set<number>()
  const players = allPlayers.filter(p => {
    const ranking = Number(p.ranking)
    const isTeam  = p.rankingClass === 'team'   // singolare maschile
    const inTop100 = ranking >= 1 && ranking <= 100
    const notDupe  = !seenRankings.has(ranking)
    if (isTeam && inTop100 && notDupe) {
      seenRankings.add(ranking)
      return true
    }
    return false
  })

  let updated = 0
  let skipped = 0

  for (const p of players) {
    const ranking = Number(p.ranking)
    const name    = p.team?.name
    const apiId   = String(p.team?.id)
    const price   = Math.max(1, Math.ceil((100 - ranking) / 10))

    if (!name || !ranking) { skipped++; continue }

    const { error } = await supabase.from('atp_players').upsert(
      {
        api_player_id: apiId,
        name,
        ranking,
        price,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'api_player_id' },
    )

    if (error) {
      // Fallback: aggiorna per nome se il giocatore era già nel DB senza api_player_id
      await supabase
        .from('atp_players')
        .update({ ranking, price, api_player_id: apiId, updated_at: new Date().toISOString() })
        .ilike('name', name)
      skipped++
    } else {
      updated++
    }
  }

  // Aggiorna moltiplicatori sulle picks non ancora bloccate
  await supabase.rpc('refresh_pick_multipliers')

  return new Response(
    JSON.stringify({ updated_players: updated, skipped, total_filtered: players.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

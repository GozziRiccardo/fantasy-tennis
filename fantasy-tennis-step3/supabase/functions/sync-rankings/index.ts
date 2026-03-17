// supabase/functions/sync-rankings/index.ts
//
// Runs once a day (via pg_cron) to keep ATP rankings + prices fresh.
// This matters because multipliers are computed from the ranking
// at the time picks are locked — so we want them up-to-date.

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

  // Fetch current ATP top 100 rankings
  const url = 'https://api-tennis.p.rapidapi.com/rankings?type=ATP&nb=100'
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
  const players = json.result ?? json.response ?? []

  let updated = 0
  for (const p of players) {
    const ranking = Number(p.rank ?? p.position)
    const name    = p.player?.name ?? p.full_name ?? p.name
    const apiId   = String(p.player?.id ?? p.player_id ?? p.id)
    const price   = Math.max(1, Math.ceil((100 - ranking) / 10))

    if (!name || !ranking) continue

    // Upsert by api_player_id
    await supabase.from('atp_players').upsert(
      { api_player_id: apiId, name, ranking, price, updated_at: new Date().toISOString() },
      { onConflict: 'api_player_id' },
    )
    updated++
  }

  // Also refresh multipliers on UNLOCKED picks for upcoming tournaments
  // (locked picks keep the multiplier frozen at lock time — correct by design)
  await supabase.rpc('refresh_pick_multipliers')

  return new Response(
    JSON.stringify({ updated_players: updated }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

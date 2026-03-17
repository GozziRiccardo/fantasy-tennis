// supabase/functions/sync-tournament/index.ts
// Sincronizza partite e risultati per i tornei in corso.
// Cron: ogni ora dalle 6:00 alle 23:00 UTC

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Tournament {
  id: string
  name: string
  type: 'slam' | 'masters1000'
  api_tournament_id: string
  total_rounds: number
  start_date: string
  end_date: string
}

interface ApiMatch {
  id: string
  round: { name: string; round: number }
  home: { id: string; name: string }
  away: { id: string; name: string }
  winner_home: boolean | null
  winner_away: boolean | null
  date: string
  status: string
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

  const { data: ongoing, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'ongoing')

  if (tErr) return jsonError(tErr.message, 500)
  if (!ongoing || ongoing.length === 0) {
    return jsonOk({ message: 'No ongoing tournaments.' })
  }

  const results: Record<string, unknown>[] = []

  for (const tournament of ongoing as Tournament[]) {
    try {
      const summary = await syncTournament(supabase, rapidApiKey, tournament)
      results.push({ tournament: tournament.name, ...summary })
    } catch (e) {
      results.push({ tournament: tournament.name, error: String(e) })
    }
  }

  return jsonOk({ synced: results })
})

async function syncTournament(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  tournament: Tournament,
) {
  const apiMatches = await fetchTournamentMatches(apiKey, tournament.api_tournament_id)

  let inserted = 0
  let updated  = 0

  for (const m of apiMatches) {
    if (!m.home?.id || !m.away?.id) continue

    const roundNumber = m.round?.round ?? 0
    const status      = mapStatus(m.status)

    const { data: matchRow, error: mErr } = await supabase
      .from('matches')
      .upsert({
        tournament_id: tournament.id,
        round_number:  roundNumber,
        round_name:    m.round?.name ?? `Round ${roundNumber}`,
        status,
        api_match_id:  m.id,
        match_date:    m.date ?? null,
      }, { onConflict: 'api_match_id' })
      .select('id')
      .single()

    if (mErr || !matchRow) continue

    await upsertPlayer(supabase, m.home.id, m.home.name)
    await upsertPlayer(supabase, m.away.id, m.away.name)

    const { data: players } = await supabase
      .from('atp_players')
      .select('id, api_player_id')
      .in('api_player_id', [m.home.id, m.away.id])

    if (!players || players.length < 2) continue

    const homeInternal = players.find(p => p.api_player_id === m.home.id)!
    const awayInternal = players.find(p => p.api_player_id === m.away.id)!

    const isFinished = status === 'completed'
    const homeWon    = isFinished ? (m.winner_home === true) : false
    const awayWon    = isFinished ? (m.winner_away === true) : false

    await supabase.from('match_players').upsert([
      { match_id: matchRow.id, atp_player_id: homeInternal.id, is_winner: homeWon },
      { match_id: matchRow.id, atp_player_id: awayInternal.id, is_winner: awayWon },
    ], { onConflict: 'match_id,atp_player_id' })

    inserted++
    if (isFinished) updated++
  }

  // Controlla se il torneo è finito (la finale è completata)
  const { count: pendingFinals } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id)
    .eq('round_number', tournament.total_rounds)
    .neq('status', 'completed')

  if (pendingFinals === 0) {
    await supabase
      .from('tournaments')
      .update({ status: 'completed' })
      .eq('id', tournament.id)

    await supabase
      .from('picks')
      .update({ locked: true })
      .eq('tournament_id', tournament.id)

    await supabase.rpc('compute_tournament_scores', {
      p_tournament_id: tournament.id,
    })

    return { matches_processed: inserted, scores_computed: true }
  }

  return { matches_processed: inserted, completed_matches: updated }
}

async function fetchTournamentMatches(apiKey: string, tournamentId: string): Promise<ApiMatch[]> {
  const url = `https://api-tennis.p.rapidapi.com/matches?tournament_id=${tournamentId}&season_id=2026`
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key':  apiKey,
      'X-RapidAPI-Host': 'api-tennis.p.rapidapi.com',
    },
  })
  if (!res.ok) throw new Error(`API-Tennis error: ${res.status}`)
  const json = await res.json()
  return (json.result ?? json.response ?? []) as ApiMatch[]
}

async function upsertPlayer(supabase: ReturnType<typeof createClient>, apiPlayerId: string, name: string) {
  const { data: existing } = await supabase
    .from('atp_players')
    .select('id')
    .eq('api_player_id', apiPlayerId)
    .maybeSingle()

  if (!existing) {
    await supabase.from('atp_players').insert({
      api_player_id: apiPlayerId,
      name,
      ranking: 999,
      price: 1,
    })
  }
}

function mapStatus(apiStatus: string): 'scheduled' | 'live' | 'completed' {
  const s = (apiStatus ?? '').toLowerCase()
  if (s.includes('finish') || s.includes('complet')) return 'completed'
  if (s.includes('progress') || s.includes('live'))  return 'live'
  return 'scheduled'
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

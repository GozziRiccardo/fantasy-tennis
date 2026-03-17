// supabase/functions/sync-tournament/index.ts
// Sincronizza partite e risultati per i tornei in corso.
// API: tennisapi1 (SofaScore)
// Cron: ogni ora dalle 6:00 alle 23:00 UTC
//
// Endpoint SofaScore per le partite di un torneo:
// GET /api/tennis/tournament/{tournamentId}/season/{seasonId}/events/last/{page}
// GET /api/tennis/tournament/{tournamentId}/season/{seasonId}/events/next/{page}
//
// I tornei ATP su SofaScore hanno ID fissi (vedi TOURNAMENT_IDS sotto).
// La season 2026 ha un seasonId che recuperiamo dinamicamente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HEADERS = (apiKey: string) => ({
  'X-RapidAPI-Key':  apiKey,
  'X-RapidAPI-Host': 'tennisapi1.p.rapidapi.com',
})

// ID SofaScore dei principali tornei ATP
// (uniqueTournamentId — stabile di anno in anno)
const TOURNAMENT_SOFASCORE_IDS: Record<string, number> = {
  'Australian Open':     22, // ATP Australian Open
  'Roland Garros':       40, // ATP French Open
  'Wimbledon':           35, // ATP Wimbledon
  'US Open':             20, // ATP US Open
  'Indian Wells Masters': 6, // BNP Paribas Open
  'Miami Open':           1, // Miami Open
  'Monte-Carlo Masters': 45,
  'Madrid Open':         51,
  'Italian Open':        30,
  'Canadian Open':       24,
  'Cincinnati Masters':  37,
  'Shanghai Masters':    34,
  'Paris Masters':       52,
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const apiKey = Deno.env.get('RAPIDAPI_KEY')!

  // Carica i tornei in corso
  const { data: ongoing } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'ongoing')

  if (!ongoing || ongoing.length === 0) {
    return jsonOk({ message: 'No ongoing tournaments.' })
  }

  const results: any[] = []

  for (const t of ongoing) {
    try {
      // Trova l'ID SofaScore per questo torneo
      const sofascoreId = findSofascoreId(t.name)
      if (!sofascoreId) {
        // Se non abbiamo l'ID, usa api_tournament_id dal DB
        if (!t.api_tournament_id) {
          results.push({ tournament: t.name, skipped: 'No SofaScore ID found' })
          continue
        }
      }

      const tournamentId = sofascoreId ?? t.api_tournament_id

      // Recupera il seasonId corrente per questo torneo
      const seasonId = await getCurrentSeasonId(apiKey, tournamentId)
      if (!seasonId) {
        results.push({ tournament: t.name, skipped: 'Could not find current season' })
        continue
      }

      // Salva api_tournament_id se non c'era
      if (!t.api_tournament_id) {
        await supabase.from('tournaments')
          .update({ api_tournament_id: String(tournamentId) })
          .eq('id', t.id)
      }

      const summary = await syncMatches(supabase, apiKey, t, tournamentId, seasonId)
      results.push({ tournament: t.name, ...summary })
    } catch (e) {
      results.push({ tournament: t.name, error: String(e) })
    }
  }

  return jsonOk({ synced: results })
})

async function getCurrentSeasonId(apiKey: string, tournamentId: number | string): Promise<number | null> {
  const url = `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/seasons`
  const res = await fetch(url, { headers: HEADERS(apiKey) })
  if (!res.ok) return null
  const json = await res.json()
  // Prende la stagione più recente
  const seasons: any[] = json.seasons ?? []
  const current = seasons.find(s => s.year === 2026) ?? seasons[0]
  return current?.id ?? null
}

async function syncMatches(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  tournament: any,
  tournamentId: number | string,
  seasonId: number,
) {
  let processed = 0

  // Fetch partite completate (last) e prossime (next)
  const [lastRes, nextRes] = await Promise.all([
    fetch(`https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/season/${seasonId}/events/last/0`, { headers: HEADERS(apiKey) }),
    fetch(`https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/season/${seasonId}/events/next/0`, { headers: HEADERS(apiKey) }),
  ])

  const lastJson = lastRes.ok ? await lastRes.json() : {}
  const nextJson = nextRes.ok ? await nextRes.json() : {}

  const allMatches: any[] = [
    ...(lastJson.events ?? []),
    ...(nextJson.events ?? []),
  ]

  for (const m of allMatches) {
    // Struttura SofaScore:
    // m.id                    → ID match
    // m.roundInfo.round       → numero turno
    // m.roundInfo.name        → nome turno ("Round of 128", "Final"...)
    // m.homeTeam.name / m.awayTeam.name → nomi giocatori
    // m.homeTeam.id / m.awayTeam.id     → ID SofaScore giocatori
    // m.status.type           → 'finished' | 'inprogress' | 'notstarted'
    // m.winnerCode            → 1 = home vince, 2 = away vince

    const roundNumber = m.roundInfo?.round ?? 0
    const status      = mapStatus(m.status?.type ?? '')
    const homeId      = String(m.homeTeam?.id)
    const awayId      = String(m.awayTeam?.id)
    const homeName    = m.homeTeam?.name
    const awayName    = m.awayTeam?.name

    if (!homeId || !awayId) continue

    // Upsert match
    const { data: matchRow } = await supabase
      .from('matches')
      .upsert({
        tournament_id: tournament.id,
        round_number:  roundNumber,
        round_name:    m.roundInfo?.name ?? `Round ${roundNumber}`,
        status,
        api_match_id:  String(m.id),
        match_date:    m.startTimestamp ? new Date(m.startTimestamp * 1000).toISOString() : null,
      }, { onConflict: 'api_match_id' })
      .select('id')
      .single()

    if (!matchRow) continue

    // Upsert giocatori
    await upsertPlayer(supabase, homeId, homeName)
    await upsertPlayer(supabase, awayId, awayName)

    // Recupera ID interni
    const { data: players } = await supabase
      .from('atp_players')
      .select('id, api_player_id')
      .in('api_player_id', [homeId, awayId])

    if (!players || players.length < 2) continue

    const homeInternal = players.find(p => p.api_player_id === homeId)!
    const awayInternal = players.find(p => p.api_player_id === awayId)!
    const isFinished   = status === 'completed'
    const homeWon      = isFinished && m.winnerCode === 1
    const awayWon      = isFinished && m.winnerCode === 2

    await supabase.from('match_players').upsert([
      { match_id: matchRow.id, atp_player_id: homeInternal.id, is_winner: homeWon },
      { match_id: matchRow.id, atp_player_id: awayInternal.id, is_winner: awayWon },
    ], { onConflict: 'match_id,atp_player_id' })

    processed++
  }

  // Controlla se il torneo è finito
  const { count: pendingFinals } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id)
    .eq('round_number', tournament.total_rounds)
    .neq('status', 'completed')

  if (pendingFinals === 0 && processed > 0) {
    await supabase.from('tournaments').update({ status: 'completed' }).eq('id', tournament.id)
    await supabase.rpc('compute_tournament_scores', { p_tournament_id: tournament.id })
    return { matches_processed: processed, scores_computed: true }
  }

  return { matches_processed: processed }
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
      ranking: 200, // placeholder
      price: 1,
    })
  }
}

function findSofascoreId(tournamentName: string): number | null {
  const name = tournamentName.toLowerCase()
  for (const [key, id] of Object.entries(TOURNAMENT_SOFASCORE_IDS)) {
    if (name.includes(key.toLowerCase())) return id
  }
  return null
}

function mapStatus(type: string): 'scheduled' | 'live' | 'completed' {
  if (type === 'finished')     return 'completed'
  if (type === 'inprogress')   return 'live'
  return 'scheduled'
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// supabase/functions/sync-tournament/index.ts
// Sincronizza partite e risultati per i tornei in corso.
// Accetta un tournament_id opzionale nel body per forzare il sync
// anche su tornei già completati (utile per recuperare partite storiche).
// Cron: ogni ora dalle 6:00 alle 23:00 UTC

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HEADERS = (apiKey: string) => ({
  'X-RapidAPI-Key':  apiKey,
  'X-RapidAPI-Host': 'tennisapi1.p.rapidapi.com',
})

const TOURNAMENT_SOFASCORE_IDS: Record<string, number> = {
  'australian open':      22,
  'roland garros':        40,
  'french open':          40,
  'wimbledon':            35,
  'us open':              20,
  'indian wells':          6,
  'miami':                 1,
  'monte-carlo':          45,
  'monte carlo':          45,
  'madrid':               51,
  'italian open':         30,
  'rome':                 30,
  'internazionali':       30,
  'canadian open':        24,
  'montreal':             24,
  'toronto':              24,
  'cincinnati':           37,
  'western & southern':   37,
  'shanghai':             34,
  'paris masters':        52,
  'bercy':                52,
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

  // Accetta un tournament_id opzionale nel body per sync manuale
  const body       = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
  const forcedId   = body.tournament_id ?? null

  let tournaments: any[]

  if (forcedId) {
    // Sync forzato su un torneo specifico (anche se completed)
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', forcedId)
    tournaments = data ?? []
  } else {
    // Sync automatico: solo tornei in corso
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'ongoing')
    tournaments = data ?? []
  }

  if (tournaments.length === 0) {
    return jsonOk({ message: forcedId ? 'Tournament not found.' : 'No ongoing tournaments.' })
  }

  const results: any[] = []

  for (const t of tournaments) {
    try {
      const sofascoreId = findSofascoreId(t.name)
      if (!sofascoreId && !t.api_tournament_id) {
        results.push({ tournament: t.name, skipped: 'No SofaScore ID found' })
        continue
      }

      const tournamentId = sofascoreId ?? t.api_tournament_id
      const seasonId     = await getCurrentSeasonId(apiKey, tournamentId)
      if (!seasonId) {
        results.push({ tournament: t.name, skipped: 'Could not find current season' })
        continue
      }

      if (!t.api_tournament_id && sofascoreId) {
        await supabase.from('tournaments')
          .update({ api_tournament_id: String(sofascoreId) })
          .eq('id', t.id)
      }

      const summary = await syncMatches(supabase, apiKey, t, tournamentId, seasonId, !!forcedId)
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
  const json    = await res.json()
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
  isForced: boolean,
) {
  let processed = 0

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
    const roundNumber = m.roundInfo?.round ?? 0
    const status      = mapStatus(m.status?.type ?? '')
    const homeId      = String(m.homeTeam?.id)
    const awayId      = String(m.awayTeam?.id)
    const homeName    = m.homeTeam?.name
    const awayName    = m.awayTeam?.name

    if (!homeId || !awayId) continue

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

    await upsertPlayer(supabase, homeId, homeName)
    await upsertPlayer(supabase, awayId, awayName)

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

  // Se è un sync forzato su un torneo completato, non ricalcolare i punteggi
  // automaticamente — l'utente lo fa manualmente dall'Admin se serve
  if (!isForced) {
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
  }

  return { matches_processed: processed }
}

async function upsertPlayer(supabase: ReturnType<typeof createClient>, apiPlayerId: string, name: string) {
  const { data: existing } = await supabase
    .from('atp_players').select('id').eq('api_player_id', apiPlayerId).maybeSingle()
  if (!existing) {
    await supabase.from('atp_players').insert({ api_player_id: apiPlayerId, name, ranking: 200, price: 1 })
  }
}

function findSofascoreId(tournamentName: string): number | null {
  const name = tournamentName.toLowerCase()
  for (const [key, id] of Object.entries(TOURNAMENT_SOFASCORE_IDS)) {
    if (name.includes(key)) return id
  }
  return null
}

function mapStatus(type: string): 'scheduled' | 'live' | 'completed' {
  if (type === 'finished')   return 'completed'
  if (type === 'inprogress') return 'live'
  return 'scheduled'
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

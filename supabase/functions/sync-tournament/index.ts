// supabase/functions/sync-tournament/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

const HEADERS = (apiKey: string) => ({
  'X-RapidAPI-Key':  apiKey,
  'X-RapidAPI-Host': 'tennisapi1.p.rapidapi.com',
})

const UPCOMING_SYNC_WINDOW_DAYS = 2

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const apiKey = Deno.env.get('RAPIDAPI_KEY')!

  let body: { tournament_id?: string } = {}
  if (req.method === 'POST') {
    try { body = await req.json() } catch { body = {} }
  }

  const requestedId = body.tournament_id
  const forcedId = requestedId ?? null

  let tournamentsToSync: any[]

  if (requestedId) {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', requestedId)
      .maybeSingle()
    if (error) return jsonError(error.message, 500)
    if (!data) return jsonError(`Tournament not found: ${requestedId}`, 404)
    tournamentsToSync = [data]
  } else {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'ongoing')
    if (error) return jsonError(error.message, 500)
    if (!data || data.length === 0) return jsonOk({ message: 'No ongoing tournaments.' })
    tournamentsToSync = data
  }

  const results: any[] = []

  for (const tournament of tournamentsToSync) {
    const t = tournament
    try {
      if (!t.api_tournament_id) {
        results.push({ tournament: t.name, skipped: 'No api_tournament_id set in DB' })
        continue
      }

      const seasonId = await getCurrentSeasonId(apiKey, t.api_tournament_id)
      if (!seasonId) {
        results.push({ tournament: t.name, skipped: 'Could not find season' })
        continue
      }

      const summary = await syncMatches(supabase, apiKey, t, t.api_tournament_id, seasonId, !!forcedId)
      results.push({ tournament: t.name, seasonId, ...summary })
    } catch (e) {
      results.push({ tournament: t.name, error: String(e) })
    }
  }

  return jsonOk({ synced: results })
})

async function getCurrentSeasonId(apiKey: string, tournamentId: string): Promise<number | null> {
  const url = `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/seasons`
  const res = await fetch(url, { headers: HEADERS(apiKey) })
  if (!res.ok) {
    console.error(`Seasons fetch failed for ${tournamentId}: ${res.status}`)
    return null
  }
  const json = await res.json()
  const seasons: any[] = json.seasons ?? []
  console.log(`Tournament ${tournamentId} seasons:`, JSON.stringify(seasons.slice(0, 3)))
  if (seasons.length === 0) return null
  const currentYear = new Date().getFullYear()
  const season = seasons.find(s => s.year === currentYear)
    ?? seasons.find(s => s.year === currentYear - 1)
    ?? seasons[0]
  console.log(`Using season:`, JSON.stringify(season))
  return season?.id ?? null
}

async function syncMatches(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  tournament: any,
  tournamentId: string,
  seasonId: number,
  isForced: boolean,
) {
  const allMatches: any[] = []

  // Scarica tutte le partite completate (pagina fino a 10 pagine)
  for (let page = 0; page < 2; page++) {
    const res = await fetch(
      `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/season/${seasonId}/events/last/${page}`,
      { headers: HEADERS(apiKey) }
    )
    if (!res.ok) break
    const events = (await res.json()).events ?? []
    if (events.length === 0) break
    allMatches.push(...events)
  }

  // Partite future/in corso
  for (let page = 0; page < 1; page++) {
    const res = await fetch(
      `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/season/${seasonId}/events/next/${page}`,
      { headers: HEADERS(apiKey) }
    )
    if (!res.ok) break
    const events = (await res.json()).events ?? []
    if (events.length === 0) break
    allMatches.push(...events)
  }

  console.log(`Total matches fetched for ${tournament.name}: ${allMatches.length}`)

  let processed = 0

  for (const m of allMatches) {
    const roundNumber = m.roundInfo?.round ?? 0
    const status      = mapStatus(m.status?.type ?? '')
    const homeId      = String(m.homeTeam?.id)
    const awayId      = String(m.awayTeam?.id)
    const homeName    = m.homeTeam?.name ?? 'Unknown'
    const awayName    = m.awayTeam?.name ?? 'Unknown'

    if (!homeId || !awayId || homeId === 'undefined' || awayId === 'undefined') continue

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

    await supabase.from('match_players').upsert([
      { match_id: matchRow.id, atp_player_id: homeInternal.id, is_winner: isFinished && m.winnerCode === 1 },
      { match_id: matchRow.id, atp_player_id: awayInternal.id, is_winner: isFinished && m.winnerCode === 2 },
    ], { onConflict: 'match_id,atp_player_id' })

    processed++
  }

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

  return { matches_fetched: allMatches.length, matches_processed: processed }
}

async function upsertPlayer(
  supabase: ReturnType<typeof createClient>,
  apiPlayerId: string,
  name: string,
) {
  const { data: existing } = await supabase
    .from('atp_players').select('id').eq('api_player_id', apiPlayerId).maybeSingle()
  if (!existing) {
    await supabase.from('atp_players').insert({
      api_player_id: apiPlayerId,
      name,
      ranking: 200,
      price: 1,
    })
  }
}

function mapStatus(type: string): 'scheduled' | 'live' | 'completed' {
  if (type === 'finished')   return 'completed'
  if (type === 'inprogress') return 'live'
  return 'scheduled'
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

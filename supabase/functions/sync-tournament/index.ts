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
  console.log(`[sync-tournament] Request received. method=${req.method}`)

  if (req.method === 'OPTIONS') {
    console.log('[sync-tournament] OPTIONS preflight request.')
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    console.log(`[sync-tournament] Method not allowed: ${req.method}`)
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const apiKey = Deno.env.get('RAPIDAPI_KEY')!

  let body: { tournament_id?: string } = {}
  if (req.method === 'POST') {
    body = await safeJsonFromRequest<{ tournament_id?: string }>(
      req,
      'request:body',
      {},
    )
    console.log('[sync-tournament] Parsed POST body safely.')
  }

  const requestedId = body.tournament_id

  let tournamentsToSync: any[]

  if (requestedId) {
    console.log(`[sync-tournament] Forced tournament requested: ${requestedId}`)
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, type, status, start_date, end_date, api_tournament_id, api_season_id, total_rounds')
      .eq('id', requestedId)
      .maybeSingle()
    if (error) return jsonError(error.message, 500)
    if (!data) return jsonError(`Tournament not found: ${requestedId}`, 404)
    tournamentsToSync = [data]
    console.log(`[sync-tournament] RAW tournament data: ${JSON.stringify(data)}`)
  } else {
    console.log('[sync-tournament] No forced tournament_id provided. Syncing all ongoing tournaments.')
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, type, status, start_date, end_date, api_tournament_id, api_season_id, total_rounds')
      .eq('status', 'ongoing')
    if (error) return jsonError(error.message, 500)
    if (!data || data.length === 0) return jsonOk({ message: 'No ongoing tournaments.' })
    tournamentsToSync = data
  }

  const results: any[] = []

  for (const tournament of tournamentsToSync) {
    const t = tournament
    try {
      console.log(`[sync-tournament] Tournament data:`, JSON.stringify({
        id: t.id,
        name: t.name,
        api_season_id: t.api_season_id,
        api_tournament_id: t.api_tournament_id,
      }))
      console.log(`[sync-tournament] Starting sync for tournament=${t.name} (id=${t.id}, api_id=${t.api_tournament_id})`)
      if (!t.api_tournament_id) {
        results.push({ tournament: t.name, skipped: 'No api_tournament_id set in DB' })
        continue
      }

      let seasonId: string | null = t.api_season_id ? String(t.api_season_id) : null

      if (seasonId) {
        console.log(`[sync-tournament] Using cached api_season_id=${seasonId} for tournament=${t.name}`)
      } else {
        const fetchedSeasonId = await getCurrentSeasonId(apiKey, t.api_tournament_id)
        if (!fetchedSeasonId) {
          results.push({ tournament: t.name, skipped: 'Could not find season' })
          continue
        }

        seasonId = String(fetchedSeasonId)
        const { error: seasonUpdateError } = await supabase
          .from('tournaments')
          .update({ api_season_id: String(seasonId) })
          .eq('id', t.id)

        if (seasonUpdateError) {
          console.warn(
            `[sync-tournament] Failed to persist api_season_id=${seasonId} for tournament=${t.name}: ${seasonUpdateError.message}`,
          )
        } else {
          console.log(`[sync-tournament] Saved api_season_id=${seasonId} for tournament=${t.name}`)
        }
      }

      const summary = await syncMatches(supabase, apiKey, t, t.api_tournament_id, seasonId)
      console.log(`[sync-tournament] Sync completed for tournament=${t.name}.`, JSON.stringify(summary))
      results.push({ tournament: t.name, seasonId, ...summary })
    } catch (e) {
      console.error(`[sync-tournament] Sync failed for tournament=${t.name}:`, e)
      results.push({ tournament: t.name, error: String(e) })
    }
  }

  console.log('[sync-tournament] All tournament syncs completed.')
  return jsonOk({ synced: results })
})

async function getCurrentSeasonId(apiKey: string, tournamentId: string): Promise<number | null> {
  console.log(`[sync-tournament] Fetching seasons for tournamentId=${tournamentId}`)
  const url = `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/seasons`
  let res: Response
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    res = await fetch(url, {
      headers: HEADERS(apiKey),
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch (e) {
    clearTimeout(timeout)
    if (e instanceof DOMException && e.name === 'AbortError') {
      console.log('[sync-tournament] API call timed out after 7s while fetching seasons')
      return null
    }
    console.error(`[sync-tournament] Seasons fetch network error for ${tournamentId}:`, e)
    return null
  }

  if (!res.ok) {
    console.error(`Seasons fetch failed for ${tournamentId}: ${res.status}`)
    return null
  }

  const json = await safeJsonFromResponse(
    res,
    `seasons:tournament:${tournamentId}`,
    { seasons: [] },
  )

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


async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timer)
    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function syncMatches(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  tournament: any,
  tournamentId: string,
  seasonId: string,
) {
  const allMatches: any[] = []

  console.log(`[sync-tournament] syncMatches start: tournament=${tournament.name}, tournamentId=${tournamentId}, seasonId=${seasonId}`)

  const lastEventsUrl = `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${tournamentId}/season/${seasonId}/events/last/0`
  console.log('[sync-tournament] Fetching last events page=0')

  let res: Response
  try {
    res = await fetchWithTimeout(
      lastEventsUrl,
      { headers: HEADERS(apiKey) },
      7000,
    )
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      console.log('[sync-tournament] API call timed out after 7s')
      return { matches_processed: 0, error: 'timeout' }
    }
    console.error('[sync-tournament] Network/timeout error on last events page=0:', e)
    return { matches_fetched: 0, matches_processed: 0 }
  }

  if (!res.ok) return { matches_fetched: 0, matches_processed: 0 }
  const json = await safeJsonFromResponse(
    res,
    `events:last:tournament:${tournamentId}:season:${seasonId}:page:0`,
    { events: [] },
  )
  const events: any[] = json.events ?? []
  console.log(`[sync-tournament] last events page=0 -> ${events.length} events`)
  allMatches.push(...events)

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
  return { matches_fetched: allMatches.length, matches_processed: processed }
}

async function safeResponseText(res: Response, context: string): Promise<string> {
  try {
    const text = await res.text()
    if (!text || text.trim().length === 0) {
      console.warn(`[sync-tournament] Empty response body for ${context}`)
      return ''
    }
    return text
  } catch (e) {
    console.error(`[sync-tournament] Failed reading response body for ${context}:`, e)
    return ''
  }
}

async function safeRequestText(req: Request, context: string): Promise<string> {
  try {
    const text = await req.text()
    if (!text || text.trim().length === 0) {
      console.warn(`[sync-tournament] Empty request body for ${context}`)
      return ''
    }
    return text
  } catch (e) {
    console.error(`[sync-tournament] Failed reading request body for ${context}:`, e)
    return ''
  }
}

async function safeJsonFromRequest<T extends Record<string, unknown>>(
  req: Request,
  context: string,
  fallback: T,
): Promise<T> {
  const text = await safeRequestText(req, context)
  if (!text) return fallback

  try {
    const json = JSON.parse(text)
    return (json ?? fallback) as T
  } catch (e) {
    console.error(`[sync-tournament] Malformed request JSON for ${context}:`, e)
    const preview = text.slice(0, 300)
    console.error(`[sync-tournament] Request JSON preview for ${context}: ${preview}`)
    return fallback
  }
}

async function safeJsonFromResponse<T extends Record<string, unknown>>(
  res: Response,
  context: string,
  fallback: T,
): Promise<T> {
  const text = await safeResponseText(res, context)
  if (!text) return fallback

  try {
    const json = JSON.parse(text)
    return (json ?? fallback) as T
  } catch (e) {
    console.error(`[sync-tournament] Malformed JSON for ${context}:`, e)
    const preview = text.slice(0, 300)
    console.error(`[sync-tournament] JSON preview for ${context}: ${preview}`)
    return fallback
  }
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

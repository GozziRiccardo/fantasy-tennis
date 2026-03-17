// supabase/functions/sync-schedule/index.ts
// Sincronizza il calendario tornei ATP dall'API.
// API: tennisapi1 (SofaScore)
// Cron: ogni lunedì alle 6:00 UTC
//
// SofaScore non ha un endpoint "lista tornei ATP per anno" diretto,
// quindi usiamo una lista fissa degli ID dei principali tornei
// e recuperiamo le info di ciascuno singolarmente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HEADERS = (apiKey: string) => ({
  'X-RapidAPI-Key':  apiKey,
  'X-RapidAPI-Host': 'tennisapi1.p.rapidapi.com',
})

// ID SofaScore (uniqueTournamentId) dei tornei Slam + Masters 1000
// Questi ID sono stabili di anno in anno
const ATP_TOURNAMENTS = [
  { id: 22,  name: 'Australian Open',      type: 'slam',        total_rounds: 7 },
  { id: 6,   name: 'Indian Wells Masters', type: 'masters1000', total_rounds: 6 },
  { id: 1,   name: 'Miami Open',           type: 'masters1000', total_rounds: 6 },
  { id: 45,  name: 'Monte-Carlo Masters',  type: 'masters1000', total_rounds: 6 },
  { id: 51,  name: 'Madrid Open',          type: 'masters1000', total_rounds: 6 },
  { id: 30,  name: 'Italian Open',         type: 'masters1000', total_rounds: 6 },
  { id: 40,  name: 'Roland Garros',        type: 'slam',        total_rounds: 7 },
  { id: 35,  name: 'Wimbledon',            type: 'slam',        total_rounds: 7 },
  { id: 24,  name: 'Canadian Open',        type: 'masters1000', total_rounds: 6 },
  { id: 37,  name: 'Cincinnati Masters',   type: 'masters1000', total_rounds: 6 },
  { id: 20,  name: 'US Open',              type: 'slam',        total_rounds: 7 },
  { id: 34,  name: 'Shanghai Masters',     type: 'masters1000', total_rounds: 6 },
  { id: 52,  name: 'Paris Masters',        type: 'masters1000', total_rounds: 6 },
]

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const apiKey = Deno.env.get('RAPIDAPI_KEY')!
  const year   = new Date().getFullYear()

  let inserted = 0
  let updated  = 0

  for (const t of ATP_TOURNAMENTS) {
    try {
      // Recupera le stagioni del torneo per trovare quella dell'anno corrente
      const seasonsRes = await fetch(
        `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${t.id}/seasons`,
        { headers: HEADERS(apiKey) }
      )
      if (!seasonsRes.ok) continue

      const seasonsJson = await seasonsRes.json()
      const season = (seasonsJson.seasons ?? []).find((s: any) => s.year === year)
      if (!season) continue

      // Recupera le info del torneo per questa stagione
      const infoRes = await fetch(
        `https://tennisapi1.p.rapidapi.com/api/tennis/tournament/${t.id}/season/${season.id}/info`,
        { headers: HEADERS(apiKey) }
      )
      if (!infoRes.ok) continue

      const info = await infoRes.json()
      // Struttura SofaScore: info.groundInfo, info.startDateTimestamp, info.endDateTimestamp
      const startTs    = info.startDateTimestamp ?? info.tournament?.startDateTimestamp
      const endTs      = info.endDateTimestamp   ?? info.tournament?.endDateTimestamp
      const start_date = startTs ? new Date(startTs * 1000).toISOString().slice(0, 10) : null
      const end_date   = endTs   ? new Date(endTs   * 1000).toISOString().slice(0, 10) : null

      if (!start_date || !end_date) continue

      const name = `${t.name} ${year}`

      // Controlla se esiste già
      const { data: existing } = await supabase
        .from('tournaments')
        .select('id, status')
        .eq('api_tournament_id', String(t.id))
        .maybeSingle()

      if (existing) {
        // Aggiorna solo date e nome, non il status
        await supabase.from('tournaments')
          .update({ name, start_date, end_date })
          .eq('id', existing.id)
        updated++
      } else {
        await supabase.from('tournaments').insert({
          name,
          type:              t.type,
          start_date,
          end_date,
          total_rounds:      t.total_rounds,
          status:            'upcoming',
          api_tournament_id: String(t.id),
        })
        inserted++
      }
    } catch (e) {
      console.error(`Error syncing ${t.name}:`, e)
    }
  }

  return new Response(
    JSON.stringify({ inserted, updated, total: ATP_TOURNAMENTS.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

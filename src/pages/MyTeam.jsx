// src/pages/MyTeam.jsx — aggiornato con punti totali per giocatore

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getUserColorMap } from '../utils/userColors'
import './MyTeam.css'

function computeMultiplier(ranking) {
  const r = Math.min(ranking ?? 100, 100)
  const group = Math.floor((r - 1) / 5)
  const pos = (r - 1) % 5
  const base = 1 + group * 0.5
  return pos === 4 ? base + 0.25 : base
}

export default function MyTeam({ session }) {
  const [roster,   setRoster]   = useState([])
  const [allAtp,   setAllAtp]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [pointsMap, setPointsMap] = useState({}) // atp_player_id → total_points
  const [totalPointsMap, setTotalPointsMap] = useState({})
  const [tableScheduledMap, setTableScheduledMap] = useState({})
  const [ownerMap, setOwnerMap] = useState({})

  useEffect(() => {
    async function load() {
      const [{ data: rosterData }, { data: atp }] = await Promise.all([
        supabase
          .from('roster_players')
          .select('*, atp_players(*)')
          .eq('user_id', session.user.id)
          .order('atp_players(ranking)'),
        supabase
          .from('atp_players')
          .select('*')
          .order('ranking'),
      ])

      setRoster(rosterData ?? [])
      setAllAtp(atp ?? [])

      // Rose di tutti gli utenti
      const { data: allRosters } = await supabase
        .from('roster_players')
        .select('user_id, atp_player_id, profiles(username)')

      // Mappa atp_player_id → { username, color }
      const nextOwnerMap = {}
      const colorMap = await getUserColorMap(supabase)
      ;(allRosters ?? []).forEach(r => {
        const username = r.profiles?.username ?? 'Unknown'
        nextOwnerMap[r.atp_player_id] = {
          username,
          color: colorMap[r.user_id],
          isMe: r.user_id === session.user.id,
        }
      })
      setOwnerMap(nextOwnerMap)

      // Carica punti da tornei completati
      const { data: completedScores } = await supabase
        .from('tournament_scores')
        .select(`total_points, picks ( atp_player_id, user_id, is_captain )`)

      // Punti da schierato = somma di tutti gli utenti (non solo l'utente corrente)
      // La colonna mostra quanto ha reso quel giocatore in totale quando schierato da chiunque
      const scheduledMap = {}
      ;(completedScores ?? []).forEach(s => {
        const pid = s.picks?.atp_player_id
        if (!pid) return
        scheduledMap[pid] = (scheduledMap[pid] ?? 0) + (s.total_points ?? 0)
      })

      // Controlla se c'è un torneo in corso
      const { data: ongoingTournament } = await supabase
        .from('tournaments')
        .select('id, type')
        .eq('status', 'ongoing')
        .maybeSingle()

      const totalMap = {}

      // 1. Punti da picks schierate nei tornei completati (include captain bonus)
      const { data: totalScores } = await supabase.rpc('get_player_total_points')
      const pickedPlayerIds = new Set()
      ;(totalScores ?? []).forEach(s => {
        totalMap[s.atp_player_id] = Number(s.total_points) ?? 0
        pickedPlayerIds.add(s.atp_player_id)
      })

      // 2. Punti dai match per giocatori NON schierati nei tornei completati
      const { data: completedTournaments } = await supabase
        .from('tournaments')
        .select('id')
        .eq('status', 'completed')
        .gte('start_date', '2026-03-19')

      for (const ct of completedTournaments ?? []) {
        const { data: matchPts } = await supabase
          .rpc('get_player_live_points', { p_tournament_id: ct.id })
        ;(matchPts ?? []).forEach(s => {
          // Solo per giocatori NON già contati tramite picks schierate
          if (!pickedPlayerIds.has(s.atp_player_id)) {
            totalMap[s.atp_player_id] = (totalMap[s.atp_player_id] ?? 0) + s.total_points
          }
        })
      }

      // 3. Punti live dal torneo in corso (tutti i giocatori, no captain bonus)
      if (ongoingTournament) {
        const { data: liveAllScores } = await supabase
          .rpc('get_player_live_points', { p_tournament_id: ongoingTournament.id })
        ;(liveAllScores ?? []).forEach(s => {
          totalMap[s.atp_player_id] = (totalMap[s.atp_player_id] ?? 0) + s.total_points
        })
      }

      if (ongoingTournament) {
        // Qui calcoliamo soltanto i punti "Da schierato" live.
        const { data: livePickedScores } = await supabase
          .rpc('compute_live_tournament_scores', {
            p_tournament_id: ongoingTournament.id
          })

        // Map per le CARTE (solo utente corrente, con captain bonus incluso)
        const myLiveMap = {}

        // Map per la TABELLA (tutti gli utenti sommati, senza captain bonus)
        const allScheduledMap = {}

        ;(livePickedScores ?? []).forEach(s => {
          // Tabella: somma total_points per tutti
          const pts = s.total_points ?? 0
          allScheduledMap[s.atp_player_id] = (allScheduledMap[s.atp_player_id] ?? 0) + pts

          // Carte: solo utente corrente, con captain bonus
          if (s.user_id === session.user.id) {
            const myPts = (s.total_points ?? 0)
            myLiveMap[s.atp_player_id] = (myLiveMap[s.atp_player_id] ?? 0) + myPts
          }
        })

        // Aggiorna scheduledMap per le carte (solo miei punti con captain)
        Object.entries(myLiveMap).forEach(([pid, pts]) => {
          scheduledMap[Number(pid)] = (scheduledMap[Number(pid)] ?? 0) + pts
        })

        // Tabella: somma tornei completati + torneo in corso
        const nextTableScheduledMap = { ...scheduledMap } // parte dai punti dei tornei completati
        Object.entries(allScheduledMap).forEach(([pid, pts]) => {
          nextTableScheduledMap[Number(pid)] = (nextTableScheduledMap[Number(pid)] ?? 0) + pts
        })
        setTableScheduledMap(nextTableScheduledMap)
      }
      if (!ongoingTournament) setTableScheduledMap(scheduledMap)

      setPointsMap(scheduledMap)
      setTotalPointsMap(totalMap)

      setLoading(false)
    }
    load()
  }, [session.user.id])

  if (loading) return <div className="loading-screen">Caricamento…</div>

  const totalRosterPoints = roster.reduce((sum, r) => sum + (pointsMap[r.atp_player_id] ?? 0), 0)
  const top100 = allAtp
    .filter(p => p.ranking <= 100)
    .sort((a, b) => a.ranking - b.ranking || a.name.localeCompare(b.name))
  const top100Ids = new Set(top100.map(p => p.id))
  const outsideTop100 = allAtp
    .filter(p => p.ranking > 100 && ownerMap[p.id] && !top100Ids.has(p.id))
    .sort((a, b) => a.ranking - b.ranking)

  function renderPlayerRow(p) {
    const totalPts = totalPointsMap[p.id] ?? 0
    const scheduledPts = tableScheduledMap[p.id] ?? 0
    return (
      <tr key={p.id} className={ownerMap[p.id]?.isMe ? 'row-owned' : ''}>
        <td className="mono" style={{ color: 'var(--text3)', fontSize: 12 }}>#{p.ranking}</td>
        <td className="player-col">{p.name}</td>
        <td className="mono">×{computeMultiplier(p.ranking)}</td>
        <td>
          {ownerMap[p.id] ? (
            <span
              className="mono"
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: ownerMap[p.id].color.text,
                background: ownerMap[p.id].color.bg,
                border: `1px solid ${ownerMap[p.id].color.border}`,
                padding: '2px 8px',
                borderRadius: '100px',
              }}
            >
              {ownerMap[p.id].username}
            </span>
          ) : null}
        </td>
        <td className="mono" style={{ color: totalPts > 0 ? 'var(--accent)' : 'var(--text3)' }}>
          {totalPts > 0 ? `+${totalPts}` : '—'}
        </td>
        <td className="mono" style={{ color: scheduledPts > 0 ? 'var(--text2)' : 'var(--text3)' }}>
          {scheduledPts > 0 ? `+${scheduledPts}` : '—'}
        </td>
      </tr>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">La mia rosa</h1>
          <p className="page-subtitle">
            {roster.length}/10 giocatori
            {totalRosterPoints > 0 && ` · ${totalRosterPoints} punti totali`}
          </p>
        </div>
      </header>

      {roster.length === 0 ? (
        <div className="card empty-state">
          <p>Non hai ancora giocatori in rosa.</p>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 8 }}>
            L'asta viene effettuata prima dell'inizio della stagione.
          </p>
        </div>
      ) : (
        <div className="roster-grid">
          {roster.map(r => {
            const p    = r.atp_players
            const mult = computeMultiplier(p.ranking)
            return (
              <div key={r.id} className="player-card card card-sm">
                <div className="player-card-top">
                  <div className="player-ranking mono">#{p.ranking}</div>
                  <div className="player-mult-badge">
                    <span className="mono">×{mult}</span>
                    <span>molt.</span>
                  </div>
                </div>
                <div className="player-name">{p.name}</div>
                <div className="player-card-bottom">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="price-paid mono">{r.price_paid} crediti</span>
                  </div>
                  {(() => {
                    const totalSchierato = pointsMap[p.id] ?? 0
                    const totalPts = totalPointsMap[p.id] ?? 0

                    return (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Da schierato
                          </span>
                          <span className="mono" style={{ color: totalSchierato > 0 ? 'var(--accent)' : 'var(--text3)', fontSize: 12, fontWeight: 500 }}>
                            {totalSchierato > 0 ? `+${totalSchierato}` : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Totali
                          </span>
                          <span className="mono" style={{ color: totalPts > 0 ? 'var(--text2)' : 'var(--text3)', fontSize: 12 }}>
                            {totalPts > 0 ? `+${totalPts}` : '—'}
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Top 100 ── */}
      <div style={{ marginTop: 40 }}>
        <h2 className="display" style={{ fontSize: 28, marginBottom: 16 }}>
          Top 100
        </h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="atp-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Giocatore</th>
                <th>Molt.</th>
                <th>In rosa</th>
                <th>Punti totali</th>
                <th>Da schierato</th>
              </tr>
            </thead>
            <tbody>
              {top100.map(renderPlayerRow)}
              {outsideTop100.length > 0 && (
                <>
                  <tr>
                    <td colSpan={6} style={{
                      padding: '8px 20px',
                      fontSize: 11,
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--bg3)',
                    }}>
                      Fuori dalla top 100
                    </td>
                  </tr>
                  {outsideTop100.map(renderPlayerRow)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

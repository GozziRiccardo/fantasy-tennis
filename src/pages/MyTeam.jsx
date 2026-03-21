// src/pages/MyTeam.jsx — aggiornato con punti totali per giocatore

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getUserColorMap } from '../utils/userColors'
import './MyTeam.css'

function computeMultiplier(ranking) {
  return Math.ceil(ranking / 5)
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

      // Punti schierati da tornei completati (solo utente corrente)
      const scheduledMap = {}
      ;(completedScores ?? []).forEach(s => {
        const pid = s.picks?.atp_player_id
        const uid = s.picks?.user_id
        if (!pid || uid !== session.user.id) return
        scheduledMap[pid] = (scheduledMap[pid] ?? 0) + (s.total_points ?? 0)
      })

      // Punti totali da tornei completati (tutti gli utenti, senza captain bonus)
      const totalMap = {}
      ;(completedScores ?? []).forEach(s => {
        const pid = s.picks?.atp_player_id
        if (!pid) return
        // base_points + win_bonus = total_points - captain_bonus
        // Ma da tournament_scores non abbiamo i dettagli, usiamo total_points / 2 se capitano
        // Quindi carichiamo con la funzione get_player_total_points
      })

      const { data: totalScores } = await supabase.rpc('get_player_total_points')
      ;(totalScores ?? []).forEach(s => {
        totalMap[s.atp_player_id] = Number(s.total_points) ?? 0
      })

      // Fallback: punti totali per tutti i giocatori (anche mai schierati).
      // get_player_total_points può restituire solo giocatori presenti nelle picks.
      const { data: allMatchResults } = await supabase
        .from('match_players')
        .select(`
          atp_player_id, is_winner,
          atp_players!inner ( id, ranking ),
          matches!inner (
            status, round_name,
            tournaments!inner ( type )
          )
        `)
        .eq('matches.status', 'completed')

      const computedTotals = {}
      ;(allMatchResults ?? []).forEach(mp => {
        if (!mp.is_winner) return
        const roundName = mp.matches?.round_name ?? ''
        if (roundName.toLowerCase().includes('qualif')) return

        const pid = mp.atp_player_id
        const ranking = mp.atp_players?.ranking ?? 999
        const mult = Math.ceil(Math.min(ranking, 100) / 5)
        const isSlam = mp.matches?.tournaments?.type === 'slam'
        const pointMult = isSlam ? 2 : 1
        const pts = mult * pointMult
        computedTotals[pid] = (computedTotals[pid] ?? 0) + pts
      })

      Object.entries(computedTotals).forEach(([pid, pts]) => {
        const id = Number(pid)
        if (totalMap[id] == null) totalMap[id] = pts
      })

      // Controlla se c'è un torneo in corso
      const { data: ongoingTournament } = await supabase
        .from('tournaments')
        .select('id, type')
        .eq('status', 'ongoing')
        .maybeSingle()

      if (ongoingTournament) {
        // I punti totali tabellari sono già forniti da get_player_total_points.
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
          // Tabella: somma base_points + win_bonus per tutti
          const pts = (s.base_points ?? 0) + (s.win_bonus ?? 0)
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

        // Tabella: usa solo l'aggregato di tutti gli utenti (senza captain bonus)
        const nextTableScheduledMap = { ...allScheduledMap }
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
  const top100 = allAtp.filter(p => p.ranking <= 100)
  const outsideTop100 = allAtp
    .filter(p => p.ranking > 100 && ownerMap[p.id])
    .sort((a, b) => a.ranking - b.ranking)

  function renderPlayerRow(p) {
    const totalPts = totalPointsMap[p.id] ?? 0
    const scheduledPts = tableScheduledMap[p.id] ?? 0
    return (
      <tr key={p.id} className={ownerMap[p.id]?.isMe ? 'row-owned' : ''}>
        <td className="mono">#{p.ranking}</td>
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

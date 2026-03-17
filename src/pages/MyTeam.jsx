// src/pages/MyTeam.jsx — aggiornato con punti totali per giocatore

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './MyTeam.css'

function computeMultiplier(ranking) {
  return Math.ceil(ranking / 5)
}

export default function MyTeam({ session }) {
  const [roster,   setRoster]   = useState([])
  const [allAtp,   setAllAtp]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [credits,  setCredits]  = useState(0)
  const [pointsMap, setPointsMap] = useState({}) // atp_player_id → total_points

  useEffect(() => {
    async function load() {
      const [{ data: profile }, { data: rosterData }, { data: atp }] = await Promise.all([
        supabase.from('profiles').select('credits_remaining').eq('id', session.user.id).single(),
        supabase
          .from('roster_players')
          .select('*, atp_players(*)')
          .eq('user_id', session.user.id)
          .order('atp_players(ranking)'),
        supabase
          .from('atp_players')
          .select('*')
          .lte('ranking', 100)
          .order('ranking'),
      ])

      setCredits(profile?.credits_remaining ?? 0)
      setRoster(rosterData ?? [])
      setAllAtp(atp ?? [])

      // Carica i punti totali per ogni giocatore di questa rosa
      // tournament_scores → picks → atp_player_id
      const { data: scores } = await supabase
        .from('tournament_scores')
        .select(`
          total_points,
          picks (
            atp_player_id,
            user_id
          )
        `)
        .eq('picks.user_id', session.user.id)

      // Somma i punti per giocatore
      const map = {}
      ;(scores ?? []).forEach(s => {
        const pid = s.picks?.atp_player_id
        if (!pid) return
        map[pid] = (map[pid] ?? 0) + (s.total_points ?? 0)
      })
      setPointsMap(map)

      setLoading(false)
    }
    load()
  }, [session.user.id])

  if (loading) return <div className="loading-screen">Caricamento…</div>

  const rosterIds = new Set(roster.map(r => r.atp_player_id))
  const totalRosterPoints = Object.values(pointsMap).reduce((a, b) => a + b, 0)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">La mia rosa</h1>
          <p className="page-subtitle">
            {roster.length}/10 giocatori · {credits} crediti rimasti
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
            const pts  = pointsMap[p.id] ?? 0
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
                    {pts > 0 ? (
                      <span className="player-pts mono">
                        +{pts} <span style={{ fontSize: 10, color: 'var(--text2)' }}>pts</span>
                      </span>
                    ) : (
                      <span className="player-pts-zero mono">— pts</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Top 100 ATP — Prezzi asta ── */}
      <div style={{ marginTop: 40 }}>
        <h2 className="display" style={{ fontSize: 28, marginBottom: 16 }}>
          Top 100 ATP — Prezzi asta
        </h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="atp-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Giocatore</th>
                <th>Prezzo</th>
                <th>Molt.</th>
                <th>In rosa</th>
                <th>Punti</th>
              </tr>
            </thead>
            <tbody>
              {allAtp.map(p => {
                const pts = pointsMap[p.id]
                return (
                  <tr key={p.id} className={rosterIds.has(p.id) ? 'row-owned' : ''}>
                    <td className="mono">#{p.ranking}</td>
                    <td className="player-col">{p.name}</td>
                    <td className="mono price-col">{p.price}</td>
                    <td className="mono">×{computeMultiplier(p.ranking)}</td>
                    <td>{rosterIds.has(p.id) ? <span className="in-roster-dot">●</span> : null}</td>
                    <td className="mono" style={{ color: pts > 0 ? 'var(--accent)' : 'var(--text3)' }}>
                      {pts > 0 ? `+${pts}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

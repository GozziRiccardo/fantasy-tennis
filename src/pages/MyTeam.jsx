// src/pages/MyTeam.jsx — aggiornato con punti totali per giocatore

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './MyTeam.css'

const USER_COLORS = [
  { bg: 'rgba(200,240,0,0.15)', border: 'rgba(200,240,0,0.5)', text: '#C8F000' },
  { bg: 'rgba(255,107,43,0.15)', border: 'rgba(255,107,43,0.5)', text: '#FF6B2B' },
  { bg: 'rgba(100,180,255,0.15)', border: 'rgba(100,180,255,0.5)', text: '#64B4FF' },
  { bg: 'rgba(200,120,255,0.15)', border: 'rgba(200,120,255,0.5)', text: '#C878FF' },
]

function computeMultiplier(ranking) {
  return Math.ceil(ranking / 5)
}

export default function MyTeam({ session }) {
  const [roster,   setRoster]   = useState([])
  const [allAtp,   setAllAtp]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [credits,  setCredits]  = useState(0)
  const [pointsMap, setPointsMap] = useState({}) // atp_player_id → total_points
  const [totalPointsMap, setTotalPointsMap] = useState({})
  const [ownerMap, setOwnerMap] = useState({})

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

      // Rose di tutti gli utenti
      const { data: allRosters } = await supabase
        .from('roster_players')
        .select('user_id, atp_player_id, profiles(username)')

      // Mappa atp_player_id → { username, color }
      const nextOwnerMap = {}
      const usernameColorMap = {}
      ;(allRosters ?? []).forEach(r => {
        const username = r.profiles?.username ?? 'Unknown'
        if (!usernameColorMap[r.user_id]) {
          usernameColorMap[r.user_id] = USER_COLORS[Object.keys(usernameColorMap).length % USER_COLORS.length]
        }
        nextOwnerMap[r.atp_player_id] = {
          username,
          color: usernameColorMap[r.user_id],
          isMe: r.user_id === session.user.id,
        }
      })
      setOwnerMap(nextOwnerMap)

      // Carica i punti da schierato per ogni giocatore su tutti gli utenti
      const { data: scores } = await supabase
        .from('tournament_scores')
        .select(`
          total_points,
          picks (
            atp_player_id
          )
        `)

      // Somma i punti per giocatore
      const scheduledMap = {}
      ;(scores ?? []).forEach(s => {
        const pid = s.picks?.atp_player_id
        if (!pid) return
        scheduledMap[pid] = (scheduledMap[pid] ?? 0) + (s.total_points ?? 0)
      })
      setPointsMap(scheduledMap)
      const { data: totalScores } = await supabase.rpc('get_player_total_points')
      const totalMap = {}
      ;(totalScores ?? []).forEach(s => {
        totalMap[s.atp_player_id] = s.total_points ?? 0
      })
      setTotalPointsMap(totalMap)

      setLoading(false)
    }
    load()
  }, [session.user.id])

  if (loading) return <div className="loading-screen">Caricamento…</div>

  const totalRosterPoints = roster.reduce((sum, r) => sum + (pointsMap[r.atp_player_id] ?? 0), 0)

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
            const totalPts = totalPointsMap[p.id] ?? 0
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
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Da schierato</span>
                      <span className="mono" style={{ color: pts > 0 ? 'var(--accent)' : 'var(--text3)', fontSize: 12, fontWeight: 500 }}>
                        {pts > 0 ? `+${pts}` : '—'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Totali</span>
                      <span className="mono" style={{ color: totalPts > 0 ? 'var(--text2)' : 'var(--text3)', fontSize: 12 }}>
                        {totalPts > 0 ? `+${totalPts}` : '—'}
                      </span>
                    </div>
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
                <th>Punti totali</th>
                <th>Da schierato</th>
              </tr>
            </thead>
            <tbody>
              {allAtp.map(p => {
                const totalPts = totalPointsMap[p.id] ?? 0
                const scheduledPts = pointsMap[p.id] ?? 0
                return (
                  <tr key={p.id} className={ownerMap[p.id]?.isMe ? 'row-owned' : ''}>
                    <td className="mono">#{p.ranking}</td>
                    <td className="player-col">{p.name}</td>
                    <td className="mono price-col">{p.price}</td>
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
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

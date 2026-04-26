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

      setLoading(false)
    }
    load()
  }, [session.user.id])

  if (loading) return <div className="loading-screen">Caricamento…</div>

  const top100 = allAtp
    .filter(p => p.ranking <= 100)
    .sort((a, b) => a.ranking - b.ranking || a.name.localeCompare(b.name))
  const top100Ids = new Set(top100.map(p => p.id))
  const outsideTop100 = allAtp
    .filter(p => p.ranking > 100 && ownerMap[p.id] && !top100Ids.has(p.id))
    .sort((a, b) => a.ranking - b.ranking)

  function renderPlayerRow(p) {
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
              </tr>
            </thead>
            <tbody>
              {top100.map(renderPlayerRow)}
              {outsideTop100.length > 0 && (
                <>
                  <tr>
                    <td colSpan={4} style={{
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

// src/pages/History.jsx
// Pagina "Storico" — tornei passati cliccabili con dettaglio performance

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './History.css'

function formatDate(d) {
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function History({ session }) {
  const [tournaments, setTournaments] = useState([])
  const [selected,    setSelected]    = useState(null)
  const [detail,      setDetail]      = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [detailLoad,  setDetailLoad]  = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tournaments')
        .select('*')
        .eq('status', 'completed')
        .order('start_date', { ascending: false })
      setTournaments(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function loadDetail(tournament) {
    setSelected(tournament)
    setDetailLoad(true)

    // Scores di tutti gli utenti per questo torneo
    const { data: scores } = await supabase
      .from('tournament_scores')
      .select(`
        rounds_won, base_points, captain_bonus, win_bonus, total_points,
        picks (
          is_captain, multiplier, user_id,
          atp_players ( name, ranking ),
          profiles ( username )
        )
      `)
      .eq('picks.tournament_id', tournament.id)
      .order('total_points', { ascending: false })

    // Raggruppa per utente
    const byUser = {}
    ;(scores ?? []).forEach(s => {
      const uid = s.picks?.user_id
      const username = s.picks?.profiles?.username ?? uid
      if (!byUser[uid]) byUser[uid] = { username, picks: [], total: 0 }
      byUser[uid].picks.push(s)
      byUser[uid].total += s.total_points
    })

    // Ordina utenti per punti
    const userList = Object.values(byUser).sort((a, b) => b.total - a.total)
    setDetail(userList)
    setDetailLoad(false)
  }

  if (loading) return <div className="loading-screen">Caricamento…</div>

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">Storico</h1>
          <p className="page-subtitle">{tournaments.length} tornei completati</p>
        </div>
        {selected && (
          <button className="btn btn-ghost" onClick={() => { setSelected(null); setDetail(null) }}>
            ← Tutti i tornei
          </button>
        )}
      </header>

      {!selected ? (
        /* ── Lista tornei ── */
        tournaments.length === 0 ? (
          <div className="card">
            <p style={{ color: 'var(--text2)' }}>Nessun torneo completato ancora.</p>
          </div>
        ) : (
          <div className="history-list">
            {tournaments.map(t => (
              <button key={t.id} className="history-card" onClick={() => loadDetail(t)}>
                <div className="hc-left">
                  <span className={`badge ${t.type === 'slam' ? 'badge-slam' : 'badge-masters'}`}>
                    {t.type === 'slam' ? 'Grand Slam' : 'Masters 1000'}
                  </span>
                  <div className="hc-name display">{t.name}</div>
                  <div className="hc-dates mono">{formatDate(t.start_date)} — {formatDate(t.end_date)}</div>
                </div>
                <div className="hc-arrow">→</div>
              </button>
            ))}
          </div>
        )
      ) : (
        /* ── Dettaglio torneo ── */
        <div className="history-detail">
          <div className="detail-header card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span className={`badge ${selected.type === 'slam' ? 'badge-slam' : 'badge-masters'}`}>
                {selected.type === 'slam' ? 'Grand Slam' : 'Masters 1000'}
              </span>
              <span className="badge badge-done">Completato</span>
            </div>
            <h2 className="display" style={{ fontSize: 32, marginBottom: 4 }}>{selected.name}</h2>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text2)' }}>
              {formatDate(selected.start_date)} — {formatDate(selected.end_date)}
            </p>
          </div>

          {detailLoad ? (
            <div style={{ padding: 32, color: 'var(--text2)', fontSize: 14 }}>Caricamento…</div>
          ) : detail?.length === 0 ? (
            <div className="card">
              <p style={{ color: 'var(--text2)' }}>Nessun punteggio registrato per questo torneo.</p>
            </div>
          ) : (
            <div className="detail-grid">
              {detail?.map((user, rank) => (
                <div key={user.username} className={`detail-user-card card ${rank === 0 ? 'detail-winner' : ''}`}>
                  <div className="detail-user-header">
                    <div className="detail-rank mono">
                      {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
                    </div>
                    <div className="detail-username">{user.username}</div>
                    <div className="detail-total mono">{user.total} <small>pts</small></div>
                  </div>

                  <div className="detail-picks">
                    {user.picks.map((s, i) => {
                      const p = s.picks?.atp_players
                      return (
                        <div key={i} className="detail-pick-row">
                          <div className="dp-player">
                            <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                              #{p?.ranking}
                            </span>
                            <span className="dp-name">{p?.name}</span>
                            {s.picks?.is_captain && <span className="dp-captain">★ C</span>}
                          </div>
                          <div className="dp-stats">
                            <span className="mono" style={{ fontSize: 11, color: 'var(--text2)' }}>
                              {s.rounds_won}R · ×{s.picks?.multiplier}
                            </span>
                            <div className="dp-breakdown">
                              <span className="dp-base mono">+{s.base_points}</span>
                              {s.captain_bonus > 0 && (
                                <span className="dp-bonus mono">+{s.captain_bonus} C</span>
                              )}
                              {s.win_bonus > 0 && (
                                <span className="dp-bonus mono">+{s.win_bonus} 🏆</span>
                              )}
                            </div>
                            <span className="dp-total mono">{s.total_points} pts</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

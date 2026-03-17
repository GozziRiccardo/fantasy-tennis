// src/pages/History.jsx — aggiornato con tabellone per i tornei completati

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import TournamentBracket from '../components/TournamentBracket'
import './History.css'

function formatDate(d) {
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function History({ session }) {
  const [tournaments, setTournaments] = useState([])
  const [selected,    setSelected]    = useState(null)
  const [scores,      setScores]      = useState([])
  const [activeTab,   setActiveTab]   = useState('scores') // 'scores' | 'bracket'
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

  async function selectTournament(t) {
    setSelected(t)
    setActiveTab('scores')
    setDetailLoad(true)

    const { data: sc } = await supabase
      .from('tournament_scores')
      .select(`
        rounds_won, base_points, captain_bonus, win_bonus, total_points,
        picks (
          is_captain, multiplier, user_id,
          atp_players ( name, ranking ),
          profiles ( username )
        )
      `)
      .eq('picks.tournament_id', t.id)
      .order('total_points', { ascending: false })

    // Raggruppa per utente
    const byUser = {}
    ;(sc ?? []).forEach(s => {
      const uid      = s.picks?.user_id
      const username = s.picks?.profiles?.username ?? uid
      if (!byUser[uid]) byUser[uid] = { username, picks: [], total: 0 }
      byUser[uid].picks.push(s)
      byUser[uid].total += s.total_points ?? 0
    })

    setScores(Object.values(byUser).sort((a, b) => b.total - a.total))
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
          <button className="btn btn-ghost" onClick={() => setSelected(null)}>
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
              <button key={t.id} className="history-card" onClick={() => selectTournament(t)}>
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

          {/* Header torneo */}
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

          {/* Tab selector */}
          <div className="detail-tabs">
            <button
              className={`detail-tab ${activeTab === 'scores' ? 'active' : ''}`}
              onClick={() => setActiveTab('scores')}
            >
              📊 Punteggi
            </button>
            <button
              className={`detail-tab ${activeTab === 'bracket' ? 'active' : ''}`}
              onClick={() => setActiveTab('bracket')}
            >
              🎾 Tabellone
            </button>
          </div>

          {/* ── Tab: Punteggi ── */}
          {activeTab === 'scores' && (
            detailLoad ? (
              <div style={{ padding: 24, color: 'var(--text2)', fontSize: 14 }}>Caricamento…</div>
            ) : scores.length === 0 ? (
              <div className="card">
                <p style={{ color: 'var(--text2)' }}>
                  Nessun punteggio registrato per questo torneo.
                  {' '}I punti compaiono qui solo per i tornei in cui avete schierato giocatori.
                </p>
              </div>
            ) : (
              <div className="detail-grid">
                {scores.map((user, rank) => (
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
                              <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>#{p?.ranking}</span>
                              <span className="dp-name">{p?.name}</span>
                              {s.picks?.is_captain && <span className="dp-captain">★ C</span>}
                            </div>
                            <div className="dp-stats">
                              <span className="mono" style={{ fontSize: 11, color: 'var(--text2)' }}>
                                {s.rounds_won}R · ×{s.picks?.multiplier}
                              </span>
                              <div className="dp-breakdown">
                                <span className="dp-base mono">+{s.base_points}</span>
                                {s.captain_bonus > 0 && <span className="dp-bonus mono">+{s.captain_bonus} C</span>}
                                {s.win_bonus > 0 && <span className="dp-bonus mono">+{s.win_bonus} 🏆</span>}
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
            )
          )}

          {/* ── Tab: Tabellone ── */}
          {activeTab === 'bracket' && (
            <div className="card">
              <TournamentBracket tournament={selected} session={session} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

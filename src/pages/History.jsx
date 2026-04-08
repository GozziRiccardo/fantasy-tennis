// src/pages/History.jsx — aggiornato con tabellone per i tornei completati

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import TournamentBracket from '../components/TournamentBracket'
import { getUserColorMap } from '../utils/userColors'
import './History.css'

function formatDate(d) {
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TOURNAMENTS_WITHOUT_RECORDED_SCORES = ['indian wells', 'australian open']

function hasRecordedScores(tournament) {
  const normalizedName = tournament?.name?.toLowerCase() ?? ''
  return !TOURNAMENTS_WITHOUT_RECORDED_SCORES.some((name) => normalizedName.includes(name))
}

export default function History({ session }) {
  const [tournaments, setTournaments] = useState([])
  const [selected,    setSelected]    = useState(null)
  const [scores,      setScores]      = useState([])
  const [playerScores, setPlayerScores] = useState([])
  const [allPicks, setAllPicks] = useState([])
  const [users, setUsers] = useState([])
  const [activeTab,   setActiveTab]   = useState('standings') // 'standings' | 'scores' | 'bracket'
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
    setActiveTab('standings')
    setDetailLoad(true)

    if (!hasRecordedScores(t)) {
      setScores([])
      setAllPicks([])
      setUsers([])
    } else {
      const { data: picksData } = await supabase
        .from('picks')
        .select(`
          user_id, atp_player_id, is_captain, multiplier,
          atp_players ( id, name, ranking ),
          profiles ( username )
        `)
        .eq('tournament_id', t.id)

      const picks = picksData ?? []
      setAllPicks(picks)

      const colorMap = await getUserColorMap(supabase)
      const nextUsers = Array.from(
        new Map(
          picks.map(p => {
            const color = colorMap[p.user_id] ?? { text: 'var(--text)', bg: 'transparent', border: 'var(--border)' }
            return [
              p.user_id,
              {
                id: p.user_id,
                username: p.profiles?.username ?? p.user_id,
                color,
              },
            ]
          })
        ).values()
      )
      setUsers(nextUsers)

      const { data: sc } = await supabase
        .from('tournament_scores')
        .select(`
          rounds_won, base_points, captain_bonus, win_bonus, total_points,
          picks!inner (
            tournament_id, is_captain, multiplier, user_id,
            atp_players ( name, ranking ),
            profiles ( username )
          )
        `)
        .eq('picks.tournament_id', t.id)
        .order('total_points', { ascending: false })

      // Raggruppa per utente
      const byUser = {}
      ;(sc ?? []).forEach(s => {
        const uid = s.picks?.user_id
        if (!uid) return
        const username = s.picks?.profiles?.username ?? uid
        if (!byUser[uid]) byUser[uid] = { username, picks: [], total: 0 }
        byUser[uid].picks.push(s)
        byUser[uid].total += s.total_points ?? 0
      })

      setScores(Object.values(byUser).sort((a, b) => b.total - a.total))
    }

    const { data: matchResults } = await supabase
      .from('match_players')
      .select(`
        atp_player_id, is_winner,
        atp_players ( id, name, ranking ),
        matches!inner ( tournament_id, status, round_number, round_name )
      `)
      .eq('matches.tournament_id', t.id)
      .eq('matches.status', 'completed')

    // Calcola max round del main draw (escludendo qualificazioni)
    const mainDrawMatches = (matchResults ?? []).filter(
      mp => !(mp.matches?.round_name ?? '').toLowerCase().includes('qualif')
    )
    const tournamentRounds = mainDrawMatches
      .map(mp => mp.matches?.round_number ?? 0)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => b - a)

    // Per ogni giocatore: vittorie reali e primo round giocato (per bye)
    const winsMap = {}
    const firstRoundMap = {}

    mainDrawMatches.forEach(mp => {
      const pid = mp.atp_player_id
      const rn = mp.matches?.round_number ?? 0
      // Traccia il primo round giocato (il più alto = più lontano dalla finale)
      if (!firstRoundMap[pid] || rn > firstRoundMap[pid]) {
        firstRoundMap[pid] = rn
      }
      if (!winsMap[pid]) winsMap[pid] = {
        player: mp.atp_players,
        realWins: 0,
        byes: 0,
        wins: 0,
        points: 0,
        wonTournament: false,
      }
      if (mp.is_winner && mp.matches?.status === 'completed') {
        winsMap[pid].realWins++
        // Ha vinto la finale?
        if ((mp.matches?.round_name ?? '') === 'Final') winsMap[pid].wonTournament = true
      }
    })

    // Calcola bye per ogni giocatore
    Object.keys(winsMap).forEach(pid => {
      const firstRound = firstRoundMap[pid] ?? 0
      // Conta quanti round del main draw esistono DOPO il primo round giocato
      // (stessa logica della funzione SQL get_player_byes)
      const byes = tournamentRounds.filter(r => r > firstRound).length
      winsMap[pid].byes = byes
      winsMap[pid].wins = winsMap[pid].realWins + byes
    })

    function getMultiplier(ranking) {
      const r = Math.min(ranking ?? 100, 100)
      const group = Math.floor((r - 1) / 5)
      const pos = (r - 1) % 5
      const base = 1 + group * 0.5
      return pos === 4 ? base + 0.25 : base
    }

    const pm = t.type === 'slam' ? 1.5 : 1
    const winBonus = t.type === 'slam' ? 20 : 10

    Object.values(winsMap).forEach(entry => {
      const mult = getMultiplier(entry.player?.ranking ?? 100)
      const base = Math.floor(mult * Math.pow(entry.wins, 2) * pm)
      entry.points = base + (entry.wonTournament ? winBonus : 0)
    })

    setPlayerScores(
      Object.values(winsMap)
        .filter(s => s.wins > 0)
        .sort((a, b) => b.points - a.points)
    )

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
              className={`detail-tab ${activeTab === 'standings' ? 'active' : ''}`}
              onClick={() => setActiveTab('standings')}
            >
              📊 Punteggi
            </button>
            <button
              className={`detail-tab ${activeTab === 'scores' ? 'active' : ''}`}
              onClick={() => setActiveTab('scores')}
            >
              📊 Score giocatori
            </button>
            <button
              className={`detail-tab ${activeTab === 'bracket' ? 'active' : ''}`}
              onClick={() => setActiveTab('bracket')}
            >
              🎾 Tabellone
            </button>
          </div>

          {/* ── Tab: Punteggi ── */}
          {activeTab === 'standings' && (
            detailLoad ? (
              <div style={{ padding: 24, color: 'var(--text2)', fontSize: 14 }}>Caricamento…</div>
            ) : scores.length === 0 ? (
              <div className="card">
                <p style={{ color: 'var(--text2)' }}>
                  Nessun punteggio registrato per questo torneo.
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

          {activeTab === 'scores' && (
            <ScoresView playerScores={playerScores} allPicks={allPicks} users={users} />
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

function ScoresView({ playerScores, allPicks, users }) {
  const pickedPlayerIds = new Set(allPicks.map(p => p.atp_player_id))
  const pickedScores = playerScores
    .filter(s => pickedPlayerIds.has(s.player?.id))

  return (
    <div className="scores-view">
      <div className="scores-section">
        <div className="scores-section-title">Punti totali — tutti i giocatori</div>
        {playerScores.length === 0 ? (
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Nessuna partita completata.</p>
        ) : (
          <div className="scores-list">
            {playerScores.map((s, i) => (
              <div key={s.player?.id} className="score-row">
                <span className="score-rank mono">#{i + 1}</span>
                <span className="score-name">{s.player?.name}</span>
                <span className="score-ranking mono" style={{ color: 'var(--text3)', fontSize: 11 }}>
                  {s.player?.ranking >= 200 ? 'fuori top 100' : `ATP #${s.player?.ranking}`}
                </span>
                <span className="score-pts mono">{s.wins}V · +{s.points}pts</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="scores-section" style={{ marginTop: 32 }}>
        <div className="scores-section-title">Punti schierati — solo picks</div>
        {pickedScores.length === 0 ? (
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Nessun giocatore schierato ha ancora giocato.</p>
        ) : (
          <div className="scores-list">
            {pickedScores.map((s, i) => {
              const pick = allPicks.find(p => p.atp_player_id === s.player?.id)
              const user = users.find(u => u.id === pick?.user_id)
              return (
                <div key={s.player?.id} className="score-row">
                  <span className="score-rank mono">#{i + 1}</span>
                  <span className="score-name">{s.player?.name}</span>
                  {user && (
                    <span className="score-owner" style={{
                      color: user.color.text,
                      background: user.color.bg,
                      border: `1px solid ${user.color.border}`,
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: '100px',
                    }}>
                      {pick?.is_captain ? '★ ' : ''}{user.username}
                    </span>
                  )}
                  <span className="score-pts mono">{s.wins}V · +{s.points}pts</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

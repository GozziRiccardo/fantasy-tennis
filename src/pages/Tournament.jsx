// src/pages/Tournament.jsx — aggiornato per usare TournamentBracket condiviso

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import TournamentBracket from '../components/TournamentBracket'
import { getUserColorMap } from '../utils/userColors'
import './Tournament.css'

function formatDate(d) {
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function isBracketAvailableForTournament(tournament) {
  if (!tournament) return false
  if (tournament.status !== 'upcoming') return true

  const startDate = new Date(tournament.start_date)
  if (Number.isNaN(startDate.getTime())) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const bracketAvailableFrom = new Date(startDate)
  bracketAvailableFrom.setDate(bracketAvailableFrom.getDate() - 2)
  bracketAvailableFrom.setHours(0, 0, 0, 0)

  return today >= bracketAvailableFrom
}

export default function Tournament({ session }) {
  const [tournament, setTournament] = useState(null)
  const [tournaments, setTournaments] = useState([])
  const [activeTournamentId, setActiveTournamentId] = useState(null)
  const [isUpcoming, setIsUpcoming] = useState(false)
  const [tournamentStandings, setTournamentStandings] = useState([])
  const [liveScores, setLiveScores] = useState([])
  const [colorMap, setColorMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'bracket' | 'scores'
  const [playerScores, setPlayerScores] = useState([])
  const [allPicks, setAllPicks] = useState([])
  const [users, setUsers] = useState([])
  const [eliminatedIds, setEliminatedIds] = useState(new Set())

  useEffect(() => {
    load()

    // Realtime — ricarica se cambiano le partite
    const channel = supabase
      .channel('tournament-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [activeTournamentId])

  async function load() {
    setLoading(true)

    // Fetch ongoing tournament
    const { data: ongoingT } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'ongoing')
      .maybeSingle()

    // Fetch upcoming tournament starting within 2 days
    const in2days = new Date()
    in2days.setDate(in2days.getDate() + 2)
    const in2daysStr = in2days.toISOString().slice(0, 10)

    const { data: upcomingT } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'upcoming')
      .lte('start_date', in2daysStr)
      .order('start_date')
      .maybeSingle()

    const tournamentsToShow = [
      ...(ongoingT ? [ongoingT] : []),
      ...(upcomingT ? [upcomingT] : []),
    ].filter((item, i, arr) => arr.findIndex(x => x.id === item.id) === i)

    setTournaments(tournamentsToShow)

    const selectedTournament = activeTournamentId
      ? tournamentsToShow.find((item) => item.id === activeTournamentId)
      : (ongoingT ?? upcomingT)

    // Priority: ongoing first, then upcoming
    const t = selectedTournament ?? ongoingT ?? upcomingT

    if (!activeTournamentId && t) {
      setActiveTournamentId(t.id)
    }

    setTournament(t)
    setIsUpcoming(t?.status === 'upcoming')
    const nextColorMap = await getUserColorMap(supabase)
    setColorMap(nextColorMap)

    if (!t) {
      setTournamentStandings([])
      setLiveScores([])
      setPlayerScores([])
      setAllPicks([])
      setUsers([])
      setEliminatedIds(new Set())
      setLoading(false)
      return
    }

    const { data: eliminatedData } = await supabase
      .from('match_players')
      .select('atp_player_id, is_winner, matches!inner(tournament_id, status)')
      .eq('matches.tournament_id', t.id)
      .eq('matches.status', 'completed')
      .eq('is_winner', false)

    const eliminated = new Set(
      (eliminatedData ?? []).map((e) => e.atp_player_id)
    )
    setEliminatedIds(eliminated)

    // Load picks + scores for all users for this tournament
    const { data: nextPicks } = await supabase
      .from('picks')
      .select(`
        user_id, atp_player_id, is_captain, multiplier, locked,
        atp_players ( id, name, ranking ),
        profiles ( username )
      `)
      .eq('tournament_id', t.id)

    const picks = nextPicks ?? []
    setAllPicks(picks)

    const nextUsers = Array.from(
      new Map(
        picks.map(p => {
          const color = nextColorMap[p.user_id] ?? { text: 'var(--text)', bg: 'transparent', border: 'var(--border)' }
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

    // Live scores from SQL function
    const { data: nextLiveScores } = await supabase
      .rpc('compute_live_tournament_scores', { p_tournament_id: t.id })
    setLiveScores(nextLiveScores ?? [])

    // Check if picks are locked
    const picksLocked = picks.some((p) => p.locked)

    if (picksLocked) {
      // Group by user
      const byUser = {}
      picks.forEach((p) => {
        const uid = p.user_id
        const username = p.profiles?.username ?? uid
        if (!byUser[uid]) byUser[uid] = { uid, username, picks: [], points: 0 }
        byUser[uid].picks.push(p)
      })

      // Add points from live scores
      ;(nextLiveScores ?? []).forEach((s) => {
        const uid = s.user_id
        if (byUser[uid]) byUser[uid].points += s.total_points ?? 0
      })

      // Sort by points descending
      const standings = Object.values(byUser).sort((a, b) => b.points - a.points)
      setTournamentStandings(standings)
    } else {
      setTournamentStandings([])
    }

    // All matches in this tournament with player results
    const { data: matchResults } = await supabase
      .from('match_players')
      .select(`
        atp_player_id, is_winner,
        atp_players ( id, name, ranking ),
        matches!inner ( tournament_id, status, round_number, round_name )
      `)
      .eq('matches.tournament_id', t.id)
      .eq('matches.status', 'completed')

    // Count wins per player
    const winsMap = {}
    ;(matchResults ?? []).forEach(mp => {
      if (!mp.is_winner) return
      // Escludi qualificazioni
      const roundName = mp.matches?.round_name ?? ''
      if (roundName.toLowerCase().includes('qualif')) return
      const pid = mp.atp_player_id
      if (!winsMap[pid]) winsMap[pid] = {
        player: mp.atp_players,
        wins: 0,
        points: 0,
      }
      winsMap[pid].wins++
    })

    // Calculate points (multiplier from atp_players.ranking)
    const pointMult = t.type === 'slam' ? 2 : 1
    Object.values(winsMap).forEach(entry => {
      const mult = Math.ceil(Math.min(entry.player.ranking, 100) / 5)
      entry.points = mult * pointMult * entry.wins
    })

    setPlayerScores(
      Object.values(winsMap).sort((a, b) => b.points - a.points)
    )

    setLoading(false)
  }

  if (loading) return <div className="loading-screen">Caricamento…</div>

  if (!tournament) return (
    <div className="page">
      <header className="page-header">
        <div><h1 className="page-title display">Torneo</h1></div>
      </header>
      <div className="card">
        <p style={{ color: 'var(--text2)' }}>Nessun torneo in corso al momento.</p>
      </div>
    </div>
  )

  const showBracket = isBracketAvailableForTournament(tournament)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">{tournament.name}</h1>
          <p className="page-subtitle">
            {formatDate(tournament.start_date)} — {formatDate(tournament.end_date)}
            {tournament.status === 'upcoming' && ' · Non ancora iniziato'}
          </p>
        </div>
        <span className={`badge ${tournament.status === 'ongoing' ? 'badge-live' : 'badge-upcoming'}`}>
          {tournament.status === 'ongoing' ? '● Live' : 'Upcoming'}
        </span>
      </header>

      {tournaments.length > 1 && (
        <div className="tournament-tabs">
          {tournaments.map((t) => (
            <button
              key={t.id}
              className={`tournament-tab ${activeTournamentId === t.id ? 'active' : ''}`}
              onClick={() => setActiveTournamentId(t.id)}
            >
              {t.name}
              {t.status === 'upcoming' && (
                <span className="upcoming-badge">🔜</span>
              )}
            </button>
          ))}
        </div>
      )}

      {isUpcoming && tournament && (
        <div className="upcoming-banner">
          🔜 Il torneo inizia il{' '}
          <strong>
            {new Date(tournament.start_date).toLocaleDateString('it-IT', {
              day: 'numeric', month: 'long',
            })}
          </strong>
          {' '}— tabellone preliminare, gli schieramenti sono ancora aperti.
        </div>
      )}

      <div className="view-toggle" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`toggle-btn ${view === 'list' ? 'active' : ''}`}
          onClick={() => setView('list')}
        >
          📋 Lista
        </button>
        <button
          className={`toggle-btn ${view === 'bracket' ? 'active' : ''}`}
          onClick={() => setView('bracket')}
        >
          🎾 Bracket
        </button>
        <button
          className={`toggle-btn ${view === 'scores' ? 'active' : ''}`}
          onClick={() => setView('scores')}
        >
          📊 Scores
        </button>
      </div>

      {view === 'list' && tournamentStandings.length > 0 && (
        <div className="tournament-standings">
          {tournamentStandings.map((user, rank) => {
            const color = colorMap[user.uid]
            const medals = ['🥇', '🥈', '🥉']
            return (
              <div
                key={user.uid}
                className="standing-card"
                style={{ borderColor: color?.border, background: color?.bg }}
              >
                <div className="standing-header">
                  <span className="standing-medal">
                    {rank < 3 ? medals[rank] : `#${rank + 1}`}
                  </span>
                  <span className="standing-username" style={{ color: color?.text }}>
                    {user.username}
                  </span>
                  <span className="standing-points mono">
                    {user.points > 0 ? `+${user.points}` : '0'} <small>pts</small>
                  </span>
                </div>
                <div className="standing-picks">
                  {user.picks.map(p => {
                    const score = (liveScores ?? []).find(
                      s => s.user_id === user.uid && s.atp_player_id === p.atp_player_id
                    )
                    return (
                      <div key={p.atp_player_id} className="standing-pick">
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>
                          #{p.atp_players?.ranking}
                        </span>
                        <span
                          className="standing-pick-name"
                          style={eliminatedIds.has(p.atp_player_id) ? {
                            textDecoration: 'line-through',
                            color: 'var(--text3)',
                            opacity: 0.6,
                          } : {}}
                        >
                          {p.atp_players?.name}
                        </span>
                        {p.is_captain && (
                          <span className="standing-captain" style={{ color: color?.text }}>★</span>
                        )}
                        <span className="mono" style={{ fontSize: 11, color: color?.text }}>
                          +{score?.total_points ?? 0}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {view === 'list' && tournamentStandings.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            La classifica sarà disponibile quando le picks verranno bloccate.
          </p>
        </div>
      )}

      {view === 'bracket' && (!showBracket ? (
        <div className="card">
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            Il tabellone sarà disponibile da 2 giorni prima dell'inizio torneo.
          </p>
        </div>
      ) : (
        <TournamentBracket tournament={tournament} session={session} />
      ))}

      {view === 'scores' && (
        <ScoresView
          playerScores={playerScores}
          allPicks={allPicks}
          users={users}
        />
      )}
    </div>
  )
}

function ScoresView({ playerScores, allPicks, users }) {
  // Picked players with their scores
  const pickedPlayerIds = new Set(allPicks.map(p => p.atp_player_id))
  const pickedScores = playerScores
    .filter(s => pickedPlayerIds.has(s.player.id))

  return (
    <div className="scores-view">
      {/* All players */}
      <div className="scores-section">
        <div className="scores-section-title">Punti totali — tutti i giocatori</div>
        {playerScores.length === 0 ? (
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Nessuna partita completata.</p>
        ) : (
          <div className="scores-list">
            {playerScores.map((s, i) => (
              <div key={s.player.id} className="score-row">
                <span className="score-rank mono">#{i + 1}</span>
                <span className="score-name">{s.player.name}</span>
                <span className="score-ranking mono" style={{ color: 'var(--text3)', fontSize: 11 }}>
                  {s.player.ranking >= 200 ? 'fuori top 100' : `ATP #${s.player.ranking}`}
                </span>
                <span className="score-pts mono">{s.wins}V · +{s.points}pts</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Picked players only */}
      <div className="scores-section" style={{ marginTop: 32 }}>
        <div className="scores-section-title">Punti schierati — solo picks</div>
        {pickedScores.length === 0 ? (
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Nessun giocatore schierato ha ancora giocato.</p>
        ) : (
          <div className="scores-list">
            {pickedScores.map((s, i) => {
              const pick = allPicks.find(p => p.atp_player_id === s.player.id)
              const user = users.find(u => u.id === pick?.user_id)
              return (
                <div key={s.player.id} className="score-row">
                  <span className="score-rank mono">#{i + 1}</span>
                  <span className="score-name">{s.player.name}</span>
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

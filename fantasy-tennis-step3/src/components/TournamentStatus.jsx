// src/components/TournamentStatus.jsx
//
// Drop this into Dashboard.jsx to show live match results
// for the ongoing tournament, filtered to your squad's players.

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './TournamentStatus.css'

function roundLabel(n, total) {
  if (n === total)     return 'Finale'
  if (n === total - 1) return 'Semifinale'
  if (n === total - 2) return 'Quarti'
  if (n === total - 3) return 'Ottavi'
  return `R${n}`
}

export default function TournamentStatus({ session, tournament }) {
  const [matches,  setMatches]  = useState([])
  const [myPicks,  setMyPicks]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!tournament) return

    async function load() {
      // Load all matches for this tournament with their players
      const { data: m } = await supabase
        .from('matches')
        .select(`
          id, round_number, round_name, status, match_date,
          match_players (
            is_winner,
            atp_players ( id, name, ranking )
          )
        `)
        .eq('tournament_id', tournament.id)
        .eq('status', 'completed')
        .order('round_number', { ascending: false })
        .limit(40)

      // Load this user's picks for this tournament
      const { data: picks } = await supabase
        .from('picks')
        .select('atp_player_id, is_captain, multiplier')
        .eq('user_id', session.user.id)
        .eq('tournament_id', tournament.id)

      setMatches(m ?? [])
      setMyPicks(picks ?? [])
      setLoading(false)
    }

    load()

    // Realtime subscription — auto-refresh when match_players changes
    const channel = supabase
      .channel('match-updates')
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'match_players',
      }, () => load())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tournament, session.user.id])

  if (!tournament || loading) return null

  const myPlayerIds = new Set(myPicks.map(p => p.atp_player_id))

  // Group matches by round
  const byRound = matches.reduce((acc, m) => {
    const key = m.round_number
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  const rounds = Object.keys(byRound)
    .map(Number)
    .sort((a, b) => b - a) // highest round first

  return (
    <div className="tournament-status">
      <div className="ts-header">
        <h2 className="display ts-title">{tournament.name}</h2>
        <span className="badge badge-live">● Live</span>
      </div>

      {rounds.length === 0 && (
        <p className="ts-empty">Nessun risultato ancora disponibile.</p>
      )}

      {rounds.map(round => (
        <div key={round} className="ts-round">
          <div className="ts-round-label">
            {roundLabel(round, tournament.total_rounds)}
          </div>
          <div className="ts-matches">
            {byRound[round].map(match => {
              const [p1, p2] = match.match_players ?? []
              if (!p1 || !p2) return null

              const a1 = p1.atp_players
              const a2 = p2.atp_players
              const isMyP1 = myPlayerIds.has(a1?.id)
              const isMyP2 = myPlayerIds.has(a2?.id)
              const pick1  = myPicks.find(p => p.atp_player_id === a1?.id)
              const pick2  = myPicks.find(p => p.atp_player_id === a2?.id)

              return (
                <div
                  key={match.id}
                  className={`ts-match ${(isMyP1 || isMyP2) ? 'ts-match-highlight' : ''}`}
                >
                  <div className={`ts-player ${p1.is_winner ? 'ts-winner' : 'ts-loser'} ${isMyP1 ? 'ts-mine' : ''}`}>
                    <span className="ts-player-name">{a1?.name ?? '—'}</span>
                    <div className="ts-player-badges">
                      {isMyP1 && pick1?.is_captain && <span className="ts-captain">★ C</span>}
                      {isMyP1 && <span className="ts-mult mono">×{pick1?.multiplier ?? '?'}</span>}
                    </div>
                    {p1.is_winner && <span className="ts-win-dot">✓</span>}
                  </div>

                  <div className="ts-vs">vs</div>

                  <div className={`ts-player ts-player-right ${p2.is_winner ? 'ts-winner' : 'ts-loser'} ${isMyP2 ? 'ts-mine' : ''}`}>
                    {p2.is_winner && <span className="ts-win-dot">✓</span>}
                    <div className="ts-player-badges">
                      {isMyP2 && <span className="ts-mult mono">×{pick2?.multiplier ?? '?'}</span>}
                      {isMyP2 && pick2?.is_captain && <span className="ts-captain">★ C</span>}
                    </div>
                    <span className="ts-player-name">{a2?.name ?? '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

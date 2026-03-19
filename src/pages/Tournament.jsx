// src/pages/Tournament.jsx — aggiornato per usare TournamentBracket condiviso

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import TournamentBracket from '../components/TournamentBracket'
import './Tournament.css'

const USER_COLORS = [
  { bg: 'rgba(200,240,0,0.15)', border: 'rgba(200,240,0,0.5)', text: '#C8F000' },
  { bg: 'rgba(255,107,43,0.15)', border: 'rgba(255,107,43,0.5)', text: '#FF6B2B' },
  { bg: 'rgba(100,180,255,0.15)', border: 'rgba(100,180,255,0.5)', text: '#64B4FF' },
  { bg: 'rgba(200,120,255,0.15)', border: 'rgba(200,120,255,0.5)', text: '#C878FF' },
]

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
  const [tournamentStandings, setTournamentStandings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()

    // Realtime — ricarica se cambiano le partite
    const channel = supabase
      .channel('tournament-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function load() {
    // Preferisce il torneo in corso, poi il prossimo upcoming
    const { data: ongoing } = await supabase
      .from('tournaments').select('*').eq('status', 'ongoing').limit(1).maybeSingle()
    const { data: upcoming } = await supabase
      .from('tournaments').select('*').eq('status', 'upcoming').order('start_date').limit(1).maybeSingle()

    const t = ongoing ?? upcoming ?? null

    setTournament(t)

    if (!t) {
      setTournamentStandings([])
      setLoading(false)
      return
    }

    // Load picks + scores for all users for this tournament
    const { data: allPicks } = await supabase
      .from('picks')
      .select(`
        user_id, atp_player_id, is_captain, multiplier, locked,
        atp_players ( id, name, ranking ),
        profiles ( username )
      `)
      .eq('tournament_id', t.id)

    const { data: allScores } = await supabase
      .from('tournament_scores')
      .select('total_points, picks(user_id)')
      .eq('picks.tournament_id', t.id)

    // Check if picks are locked
    const picksLocked = (allPicks ?? []).some((p) => p.locked)

    if (picksLocked) {
      // Group by user
      const byUser = {}
      ;(allPicks ?? []).forEach((p) => {
        const uid = p.user_id
        const username = p.profiles?.username ?? uid
        if (!byUser[uid]) byUser[uid] = { uid, username, picks: [], points: 0 }
        byUser[uid].picks.push(p)
      })

      // Add points from scores
      ;(allScores ?? []).forEach((s) => {
        const uid = s.picks?.user_id
        if (uid && byUser[uid]) {
          byUser[uid].points += s.total_points ?? 0
        }
      })

      // Sort by points descending
      const standings = Object.values(byUser).sort((a, b) => b.points - a.points)
      setTournamentStandings(standings)
    } else {
      setTournamentStandings([])
    }

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

      {tournamentStandings.length > 0 && (
        <div className="tournament-standings">
          {tournamentStandings.map((user, rank) => {
            const color = USER_COLORS[rank % USER_COLORS.length]
            const medals = ['🥇', '🥈', '🥉']
            return (
              <div
                key={user.uid}
                className="standing-card"
                style={{ borderColor: color.border, background: color.bg }}
              >
                <div className="standing-header">
                  <span className="standing-medal">
                    {rank < 3 ? medals[rank] : `#${rank + 1}`}
                  </span>
                  <span className="standing-username" style={{ color: color.text }}>
                    {user.username}
                  </span>
                  <span className="standing-points mono">
                    {user.points > 0 ? `+${user.points}` : '0'} <small>pts</small>
                  </span>
                </div>
                <div className="standing-picks">
                  {user.picks.map((p) => (
                    <div key={p.atp_player_id} className="standing-pick">
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>
                        #{p.atp_players?.ranking}
                      </span>
                      <span className="standing-pick-name">{p.atp_players?.name}</span>
                      {p.is_captain && (
                        <span className="standing-captain" style={{ color: color.text }}>★ C</span>
                      )}
                      <span className="mono" style={{ fontSize: 10, color: color.text }}>
                        ×{p.multiplier}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!showBracket ? (
        <div className="card">
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            Il tabellone sarà disponibile da 2 giorni prima dell'inizio torneo.
          </p>
        </div>
      ) : (
        <TournamentBracket tournament={tournament} session={session} />
      )}
    </div>
  )
}

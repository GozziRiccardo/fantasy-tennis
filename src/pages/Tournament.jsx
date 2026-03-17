// src/pages/Tournament.jsx — aggiornato per usare TournamentBracket condiviso

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import TournamentBracket from '../components/TournamentBracket'
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
  const [loading,    setLoading]    = useState(true)

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

    setTournament(ongoing ?? upcoming ?? null)
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

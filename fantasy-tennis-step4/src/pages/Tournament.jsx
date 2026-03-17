// src/pages/Tournament.jsx
// Pagina "Torneo in corso" — tabellone con bracket e lista per turno
// I giocatori dei 4 fantacalciatori sono evidenziati con colori diversi

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './Tournament.css'

// Un colore per ciascuno dei 4 utenti
const USER_COLORS = [
  { bg: 'rgba(200,240,0,0.15)',  border: 'rgba(200,240,0,0.5)',  text: '#C8F000', label: 'lime'   },
  { bg: 'rgba(255,107,43,0.15)', border: 'rgba(255,107,43,0.5)', text: '#FF6B2B', label: 'orange' },
  { bg: 'rgba(100,180,255,0.15)',border: 'rgba(100,180,255,0.5)',text: '#64B4FF', label: 'blue'   },
  { bg: 'rgba(200,120,255,0.15)',border: 'rgba(200,120,255,0.5)',text: '#C878FF', label: 'purple' },
]

function roundLabel(n, total) {
  if (n === total)     return 'Finale'
  if (n === total - 1) return 'Semifinale'
  if (n === total - 2) return 'Quarti di finale'
  if (n === total - 3) return 'Ottavi di finale'
  if (n === total - 4) return 'Quarto di finale (Q)'
  return `Turno ${n}`
}

export default function Tournament({ session }) {
  const [tournament, setTournament]   = useState(null)
  const [matches,    setMatches]      = useState([])
  const [allPicks,   setAllPicks]     = useState([])  // picks di tutti i 4 utenti
  const [users,      setUsers]        = useState([])
  const [view,       setView]         = useState('list') // 'list' | 'bracket'
  const [loading,    setLoading]      = useState(true)

  useEffect(() => {
    load()

    // Realtime updates
    const channel = supabase
      .channel('tournament-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function load() {
    // Torneo in corso (o più recente completato se non c'è ongoing)
    const { data: ongoing } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'ongoing')
      .limit(1)
      .maybeSingle()

    const { data: upcoming } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'upcoming')
      .order('start_date')
      .limit(1)
      .maybeSingle()

    const t = ongoing ?? upcoming
    if (!t) { setLoading(false); return }
    setTournament(t)

    // Partite con giocatori
    const { data: m } = await supabase
      .from('matches')
      .select(`
        id, round_number, round_name, status, match_date,
        match_players (
          is_winner,
          atp_players ( id, name, ranking )
        )
      `)
      .eq('tournament_id', t.id)
      .order('round_number')
    setMatches(m ?? [])

    // Picks di tutti gli utenti per questo torneo
    const { data: picks } = await supabase
      .from('picks')
      .select(`
        user_id, atp_player_id, is_captain, multiplier,
        profiles ( username )
      `)
      .eq('tournament_id', t.id)
    setAllPicks(picks ?? [])

    // Lista utenti unici con colore assegnato
    const userMap = {}
    ;(picks ?? []).forEach(p => {
      if (!userMap[p.user_id]) {
        userMap[p.user_id] = p.profiles?.username ?? p.user_id
      }
    })
    const userList = Object.entries(userMap).map(([id, username], i) => ({
      id, username, color: USER_COLORS[i % USER_COLORS.length]
    }))
    setUsers(userList)

    setLoading(false)
  }

  // Mappa player_id → {userColor, isCaptain}
  function getPlayerMeta(atpPlayerId) {
    const pick = allPicks.find(p => p.atp_player_id === atpPlayerId)
    if (!pick) return null
    const user = users.find(u => u.id === pick.user_id)
    if (!user) return null
    return { color: user.color, username: user.username, isCaptain: pick.is_captain, multiplier: pick.multiplier }
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

  const byRound = matches.reduce((acc, m) => {
    if (!acc[m.round_number]) acc[m.round_number] = []
    acc[m.round_number].push(m)
    return acc
  }, {})
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">{tournament.name}</h1>
          <p className="page-subtitle">
            {tournament.status === 'ongoing'
              ? `${matches.filter(m => m.status === 'completed').length} partite completate`
              : 'Torneo non ancora iniziato — il tabellone apparirà qui'}
          </p>
        </div>
        <div className="view-toggle">
          <button
            className={`toggle-btn ${view === 'list' ? 'active' : ''}`}
            onClick={() => setView('list')}
          >☰ Lista</button>
          <button
            className={`toggle-btn ${view === 'bracket' ? 'active' : ''}`}
            onClick={() => setView('bracket')}
          >⊞ Bracket</button>
        </div>
      </header>

      {/* ── Legenda colori ── */}
      {users.length > 0 && (
        <div className="color-legend">
          {users.map(u => (
            <div key={u.id} className="legend-item" style={{ borderColor: u.color.border }}>
              <div className="legend-dot" style={{ background: u.color.text }} />
              <span>{u.username}</span>
            </div>
          ))}
        </div>
      )}

      {tournament.status === 'upcoming' ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            Il tabellone sarà disponibile quando il torneo inizia.
          </p>
        </div>
      ) : view === 'list' ? (
        <ListView rounds={rounds} byRound={byRound} tournament={tournament} getPlayerMeta={getPlayerMeta} />
      ) : (
        <BracketView rounds={rounds} byRound={byRound} tournament={tournament} getPlayerMeta={getPlayerMeta} />
      )}
    </div>
  )
}

// ── Lista per turno ────────────────────────────────────────────
function ListView({ rounds, byRound, tournament, getPlayerMeta }) {
  if (rounds.length === 0) return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ color: 'var(--text2)', fontSize: 14 }}>Nessuna partita ancora disponibile.</p>
    </div>
  )

  return (
    <div className="list-view">
      {rounds.map(round => (
        <div key={round} className="round-section">
          <div className="round-title">
            {roundLabel(round, tournament.total_rounds)}
            <span className="round-count mono">
              {byRound[round].filter(m => m.status === 'completed').length}/{byRound[round].length}
            </span>
          </div>
          <div className="matches-list">
            {byRound[round].map(match => {
              const [mp1, mp2] = match.match_players ?? []
              if (!mp1 || !mp2) return null
              const p1   = mp1.atp_players
              const p2   = mp2.atp_players
              const m1   = getPlayerMeta(p1?.id)
              const m2   = getPlayerMeta(p2?.id)
              const done = match.status === 'completed'

              return (
                <div key={match.id} className={`match-row ${(m1 || m2) ? 'match-highlighted' : ''}`}>
                  <PlayerCell player={p1} mp={mp1} meta={m1} done={done} />
                  <div className="match-vs mono">vs</div>
                  <PlayerCell player={p2} mp={mp2} meta={m2} done={done} align="right" />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function PlayerCell({ player, mp, meta, done, align }) {
  const won  = done && mp?.is_winner
  const lost = done && !mp?.is_winner

  return (
    <div
      className={`player-cell ${align === 'right' ? 'player-cell-right' : ''} ${won ? 'cell-won' : ''} ${lost ? 'cell-lost' : ''}`}
      style={meta ? { background: meta.color.bg, borderColor: meta.color.border } : {}}
    >
      {meta && (
        <div className="cell-badges" style={{ flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
          {meta.isCaptain && <span className="cell-captain" style={{ color: meta.color.text }}>★</span>}
          <span className="cell-mult mono" style={{ color: meta.color.text }}>×{meta.multiplier ?? '?'}</span>
        </div>
      )}
      <span className="cell-name">{player?.name ?? '—'}</span>
      {won  && <span className="cell-checkmark">✓</span>}
    </div>
  )
}

// ── Bracket ────────────────────────────────────────────────────
function BracketView({ rounds, byRound, tournament, getPlayerMeta }) {
  // Mostra i turni dal più recente (finale) al più antico, scrollabile orizzontalmente
  const orderedRounds = [...rounds].sort((a, b) => b - a)

  if (orderedRounds.length === 0) return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ color: 'var(--text2)', fontSize: 14 }}>Nessuna partita ancora disponibile.</p>
    </div>
  )

  return (
    <div className="bracket-scroll">
      <div className="bracket-grid" style={{ gridTemplateColumns: `repeat(${orderedRounds.length}, 220px)` }}>
        {orderedRounds.map(round => (
          <div key={round} className="bracket-column">
            <div className="bracket-round-label">
              {roundLabel(round, tournament.total_rounds)}
            </div>
            <div className="bracket-matches">
              {byRound[round].map(match => {
                const [mp1, mp2] = match.match_players ?? []
                if (!mp1 || !mp2) return null
                const p1   = mp1.atp_players
                const p2   = mp2.atp_players
                const m1   = getPlayerMeta(p1?.id)
                const m2   = getPlayerMeta(p2?.id)
                const done = match.status === 'completed'

                return (
                  <div key={match.id} className="bracket-match">
                    <BracketPlayer player={p1} mp={mp1} meta={m1} done={done} />
                    <div className="bracket-divider" />
                    <BracketPlayer player={p2} mp={mp2} meta={m2} done={done} />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BracketPlayer({ player, mp, meta, done }) {
  const won  = done && mp?.is_winner
  const lost = done && !mp?.is_winner

  return (
    <div
      className={`bracket-player ${won ? 'bp-won' : ''} ${lost ? 'bp-lost' : ''}`}
      style={meta ? { background: meta.color.bg, borderLeft: `3px solid ${meta.color.text}` } : {}}
    >
      <span className="bp-name">{player?.name ?? 'TBD'}</span>
      <div className="bp-right">
        {meta?.isCaptain && <span style={{ color: meta.color.text, fontSize: 11 }}>★</span>}
        {won && <span className="bp-check">✓</span>}
      </div>
    </div>
  )
}

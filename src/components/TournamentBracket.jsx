// src/components/TournamentBracket.jsx

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './TournamentBracket.css'

const USER_COLORS = [
  { bg: 'rgba(200,240,0,0.15)',  border: 'rgba(200,240,0,0.5)',  text: '#C8F000' },
  { bg: 'rgba(255,107,43,0.15)', border: 'rgba(255,107,43,0.5)', text: '#FF6B2B' },
  { bg: 'rgba(100,180,255,0.15)',border: 'rgba(100,180,255,0.5)',text: '#64B4FF' },
  { bg: 'rgba(200,120,255,0.15)',border: 'rgba(200,120,255,0.5)',text: '#C878FF' },
]

function normalizeRoundName(roundName) {
  const name = String(roundName ?? '').toLowerCase()
  if (!name) return null
  if (name.includes('semi')) return 'Semifinale'
  if (name.includes('quarter') || name.includes('quarti')) return 'Quarti di finale'
  if (name.includes('round of 16') || name.includes('ottavi')) return 'Ottavi di finale'
  if (name.includes('round of 32') || name.includes('trentaduesimi')) return 'Trentaduesimi'
  if (name.includes('round of 64') || name.includes('sessantaquattresimi')) return 'Sessantaquattresimi'
  if (name.includes('qualif')) return 'Qualificazioni'
  if (name.includes('final')) return 'Finale'
  return null
}

function isFinalRoundAtMax(rounds, byRound) {
  if (rounds.length < 2) return true
  const sorted = [...rounds].sort((a, b) => a - b)
  const minRoundName = byRound[sorted[0]]?.[0]?.round_name
  const maxRoundName = byRound[sorted[sorted.length - 1]]?.[0]?.round_name
  const minIsFinal = normalizeRoundName(minRoundName) === 'Finale'
  const maxIsFinal = normalizeRoundName(maxRoundName) === 'Finale'
  if (minIsFinal && !maxIsFinal) return false
  if (maxIsFinal && !minIsFinal) return true
  return true
}

function roundLabel(roundNumber, allRounds, byRound, finalRoundAtMax) {
  const explicit = normalizeRoundName(byRound[roundNumber]?.[0]?.round_name)
  if (explicit) return explicit

  const sorted = [...new Set(allRounds)].sort((a, b) => a - b)
  const index = sorted.indexOf(roundNumber)
  const stageFromFinal = finalRoundAtMax ? sorted.length - 1 - index : index

  if (stageFromFinal === 0) return 'Finale'
  if (stageFromFinal === 1) return 'Semifinale'
  if (stageFromFinal === 2) return 'Quarti di finale'
  if (stageFromFinal === 3) return 'Ottavi di finale'
  if (stageFromFinal === 4) return 'Sedicesimi'
  if (stageFromFinal === 5) return 'Trentaduesimi'
  if (stageFromFinal === 6) return 'Sessantaquattresimi'
  return `Qualificazione T${Math.max(stageFromFinal - 6, 1)}`
}

export default function TournamentBracket({ tournament, session }) {
  const [matches,  setMatches]  = useState([])
  const [allPicks, setAllPicks] = useState([])
  const [users,    setUsers]    = useState([])
  const [view,     setView]     = useState('list')
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!tournament) return
    load()
  }, [tournament?.id])

  async function load() {
    setLoading(true)
    const [{ data: m }, { data: picks }, { data: profiles }] = await Promise.all([
      supabase
        .from('matches')
        .select(`
          id, api_match_id, match_date, round_number, round_name, status,
          match_players (
            is_winner,
            atp_players ( id, name, ranking )
          )
        `)
        .eq('tournament_id', tournament.id)
        .order('round_number')
        .order('match_date', { ascending: true, nullsFirst: false })
        .order('api_match_id', { ascending: true, nullsFirst: false }),
      supabase
        .from('picks')
        .select('user_id, atp_player_id, is_captain, multiplier')
        .eq('tournament_id', tournament.id),
      supabase.from('profiles').select('id, username'),
    ])

    setMatches(m ?? [])
    setAllPicks(picks ?? [])
    const userList = (profiles ?? []).map((p, i) => ({
      id: p.id, username: p.username, color: USER_COLORS[i % USER_COLORS.length],
    }))
    setUsers(userList)
    setLoading(false)
  }

  function getPlayerMeta(atpPlayerId) {
    const pick = allPicks.find(p => p.atp_player_id === atpPlayerId)
    if (!pick) return null
    const user = users.find(u => u.id === pick.user_id)
    if (!user) return null
    return { color: user.color, username: user.username, isCaptain: pick.is_captain, multiplier: pick.multiplier }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text2)', fontSize: 13 }}>Caricamento tabellone…</div>

  const byRound = matches.reduce((acc, m) => {
    if (!acc[m.round_number]) acc[m.round_number] = []
    acc[m.round_number].push(m)
    return acc
  }, {})

  // rounds sorted ascending: [1, 2, 3, ...] dove 1=Finale
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b)
  const allRoundNumbers = rounds
  const finalRoundAtMax = isFinalRoundAtMax(rounds, byRound)
  const hasMatches = rounds.length > 0

  // Lista e bracket devono mostrare i turni nello stesso verso (dai primi turni verso la finale)
  const listRounds = finalRoundAtMax ? [...rounds] : [...rounds].reverse()
  const bracketRounds = finalRoundAtMax ? [...rounds] : [...rounds].reverse()

  return (
    <div className="tb-container">
      <div className="tb-header">
        <div className="tb-view-toggle">
          <button className={`toggle-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
            ☰ Lista
          </button>
          <button className={`toggle-btn ${view === 'bracket' ? 'active' : ''}`} onClick={() => setView('bracket')}>
            ⊞ Bracket
          </button>
        </div>
        {users.length > 0 && (
          <div className="tb-legend">
            {users.map(u => (
              <div key={u.id} className="legend-item" style={{ borderColor: u.color.border }}>
                <div className="legend-dot" style={{ background: u.color.text }} />
                <span>{u.username}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!hasMatches ? (
        <p style={{ color: 'var(--text2)', fontSize: 13, padding: '16px 0' }}>
          Nessuna partita disponibile per questo torneo.
        </p>
      ) : view === 'list' ? (
        <ListView
          rounds={listRounds}
          byRound={byRound}
          allRoundNumbers={allRoundNumbers}
          finalRoundAtMax={finalRoundAtMax}
          getPlayerMeta={getPlayerMeta}
        />
      ) : (
        <BracketView
          rounds={bracketRounds}
          byRound={byRound}
          allRoundNumbers={allRoundNumbers}
          finalRoundAtMax={finalRoundAtMax}
          getPlayerMeta={getPlayerMeta}
        />
      )}
    </div>
  )
}

function ListView({ rounds, byRound, allRoundNumbers, finalRoundAtMax, getPlayerMeta }) {
  return (
    <div className="list-view">
      {rounds.map(round => (
        <div key={round} className="round-section">
          <div className="round-title">
            {roundLabel(round, allRoundNumbers, byRound, finalRoundAtMax)}
            <span className="round-count mono">
              {byRound[round].filter(m => m.status === 'completed').length}/{byRound[round].length}
            </span>
          </div>
          <div className="matches-list">
            {byRound[round].map(match => {
              const [mp1, mp2] = match.match_players ?? []
              if (!mp1 || !mp2) return null
              const p1 = mp1.atp_players
              const p2 = mp2.atp_players
              const m1 = getPlayerMeta(p1?.id)
              const m2 = getPlayerMeta(p2?.id)
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
          {meta.multiplier && <span className="cell-mult mono" style={{ color: meta.color.text }}>×{meta.multiplier}</span>}
        </div>
      )}
      <span className="cell-name">{player?.name ?? '—'}</span>
      {won && <span className="cell-checkmark">✓</span>}
    </div>
  )
}

function BracketView({ rounds, byRound, allRoundNumbers, finalRoundAtMax, getPlayerMeta }) {
  return (
    <div className="bracket-scroll">
      <div className="bracket-grid" style={{ gridTemplateColumns: `repeat(${rounds.length}, 220px)` }}>
        {rounds.map(round => (
          <div key={round} className="bracket-column">
            <div className="bracket-round-label">
              {roundLabel(round, allRoundNumbers, byRound, finalRoundAtMax)}
            </div>
            <div className="bracket-matches">
              {byRound[round].map(match => {
                const [mp1, mp2] = match.match_players ?? []
                if (!mp1 || !mp2) return null
                const p1 = mp1.atp_players
                const p2 = mp2.atp_players
                const m1 = getPlayerMeta(p1?.id)
                const m2 = getPlayerMeta(p2?.id)
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

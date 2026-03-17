import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './Picks.css'

function computeMultiplier(ranking) {
  return Math.ceil(ranking / 5)
}

export default function Picks({ session }) {
  const [nextTournament, setNextTournament] = useState(null)
  const [prevPicks,      setPrevPicks]      = useState([])   // player ids used last tournament
  const [roster,         setRoster]         = useState([])
  const [existingPicks,  setExistingPicks]  = useState([])
  const [selected,       setSelected]       = useState([])   // array of atp_player_id
  const [captain,        setCaptain]        = useState(null) // atp_player_id
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [msg,            setMsg]            = useState({ type: '', text: '' })

  useEffect(() => {
    async function load() {
      // 1. Next upcoming tournament
      const { data: t } = await supabase
        .from('tournaments')
        .select('*')
        .eq('status', 'upcoming')
        .order('start_date')
        .limit(1)
        .single()

      if (!t) { setLoading(false); return }
      setNextTournament(t)

      // 2. The tournament just before this one (to get prev picks)
      const { data: prevT } = await supabase
        .from('tournaments')
        .select('id')
        .lt('start_date', t.start_date)
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (prevT) {
        const { data: pp } = await supabase
          .from('picks')
          .select('atp_player_id')
          .eq('user_id', session.user.id)
          .eq('tournament_id', prevT.id)
        setPrevPicks((pp ?? []).map(p => p.atp_player_id))
      }

      // 3. User's roster
      const { data: r } = await supabase
        .from('roster_players')
        .select('*, atp_players(*)')
        .eq('user_id', session.user.id)
        .order('atp_players(ranking)')
      setRoster(r ?? [])

      // 4. Existing picks for this tournament (if already submitted)
      const { data: ep } = await supabase
        .from('picks')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('tournament_id', t.id)
      setExistingPicks(ep ?? [])
      setSelected((ep ?? []).map(p => p.atp_player_id))
      setCaptain((ep ?? []).find(p => p.is_captain)?.atp_player_id ?? null)

      setLoading(false)
    }
    load()
  }, [session.user.id])

  function toggleSelect(playerId) {
    if (selected.includes(playerId)) {
      setSelected(s => s.filter(id => id !== playerId))
      if (captain === playerId) setCaptain(null)
    } else {
      if (selected.length >= 3) {
        setMsg({ type: 'error', text: 'Puoi schierare al massimo 3 giocatori.' })
        return
      }
      setSelected(s => [...s, playerId])
      setMsg({ type: '', text: '' })
    }
  }

  async function savePicks() {
    if (selected.length !== 3) {
      setMsg({ type: 'error', text: 'Devi selezionare esattamente 3 giocatori.' })
      return
    }
    if (!captain) {
      setMsg({ type: 'error', text: 'Scegli un capitano tra i 3 selezionati.' })
      return
    }

    setSaving(true)
    setMsg({ type: '', text: '' })

    // Delete old picks for this tournament and re-insert
    await supabase
      .from('picks')
      .delete()
      .eq('user_id', session.user.id)
      .eq('tournament_id', nextTournament.id)

    const rows = selected.map(pid => ({
      user_id:       session.user.id,
      tournament_id: nextTournament.id,
      atp_player_id: pid,
      is_captain:    pid === captain,
      locked:        false,
    }))

    const { error } = await supabase.from('picks').insert(rows)
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      setMsg({ type: 'success', text: 'Scelte salvate! Puoi modificarle fino all\'inizio del torneo.' })
      setExistingPicks(rows)
    }

    setSaving(false)
  }

  if (loading) return <div className="loading-screen">Caricamento…</div>

  if (!nextTournament) return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">Schiera</h1>
        </div>
      </header>
      <div className="card">
        <p style={{ color: 'var(--text2)' }}>Nessun torneo in programma al momento.</p>
      </div>
    </div>
  )

  const isLocked = existingPicks.some(p => p.locked)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">Schiera</h1>
          <p className="page-subtitle">
            {nextTournament.name} · {selected.length}/3 selezionati
          </p>
        </div>
        {!isLocked && (
          <button
            className="btn btn-primary"
            onClick={savePicks}
            disabled={saving}
          >
            {saving ? 'Salvataggio…' : 'Salva scelte'}
          </button>
        )}
      </header>

      {isLocked && (
        <div className="locked-banner">
          🔒 Le scelte sono state bloccate — il torneo è iniziato.
        </div>
      )}

      {msg.text && (
        <div className={msg.type === 'error' ? 'error-msg' : 'success-msg'}>
          {msg.text}
        </div>
      )}

      {/* ── Selection summary strip ── */}
      <div className="selection-strip">
        {[0, 1, 2].map(i => {
          const pid = selected[i]
          const player = roster.find(r => r.atp_player_id === pid)?.atp_players
          return (
            <div key={i} className={`selection-slot ${pid ? 'filled' : ''}`}>
              {pid ? (
                <>
                  <div className="slot-name">{player?.name ?? '—'}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text2)' }}>
                      ×{computeMultiplier(player?.ranking ?? 1)}
                    </span>
                    {captain === pid ? (
                      <span className="captain-label">C</span>
                    ) : !isLocked ? (
                      <button className="set-captain-btn" onClick={() => setCaptain(pid)}>
                        → capitano
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <span className="slot-empty">Slot {i + 1}</span>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Roster grid ── */}
      <div className="picks-info">
        {prevPicks.length > 0 && (
          <p className="picks-hint">
            I giocatori <span className="hint-gray">sfumati</span> non possono essere schierati
            (schierati nel torneo precedente).
          </p>
        )}
      </div>
      <div className="picks-grid">
        {roster.map(r => {
          const p = r.atp_players
          const isSelected  = selected.includes(p.id)
          const isCaptain   = captain === p.id
          const isPrevUsed  = prevPicks.includes(p.id)
          const isDisabled  = isLocked || isPrevUsed || (!isSelected && selected.length >= 3)
          const mult        = computeMultiplier(p.ranking)

          return (
            <button
              key={r.id}
              className={[
                'pick-card',
                isSelected  ? 'pick-selected' : '',
                isCaptain   ? 'pick-captain' : '',
                isPrevUsed  ? 'pick-prev-used' : '',
                isDisabled && !isSelected ? 'pick-disabled' : '',
              ].join(' ')}
              onClick={() => !isDisabled && toggleSelect(p.id)}
              disabled={isDisabled && !isSelected}
            >
              <div className="pick-card-top">
                <span className="mono pick-rank">#{p.ranking}</span>
                <span className="mono pick-mult">×{mult}</span>
              </div>
              <div className="pick-name">{p.name}</div>
              {isSelected && !isCaptain && !isLocked && (
                <button
                  className="pick-captain-btn"
                  onClick={e => { e.stopPropagation(); setCaptain(p.id) }}
                >
                  Fai capitano
                </button>
              )}
              {isCaptain && <span className="captain-crown">★ Capitano</span>}
              {isPrevUsed && <span className="prev-used-label">Non disponibile</span>}
            </button>
          )
        })}
      </div>

      {roster.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text2)' }}>
            Non hai ancora giocatori in rosa. Completa prima l'asta.
          </p>
        </div>
      )}
    </div>
  )
}

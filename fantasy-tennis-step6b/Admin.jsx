// src/pages/Admin.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './Admin.css'

const ADMIN_EMAIL = 'TUA_EMAIL@esempio.com'  // ← cambia con la tua email

function computePrice(ranking) {
  return Math.max(1, Math.ceil((100 - ranking) / 10))
}

export default function Admin({ session }) {
  if (session.user.email !== ADMIN_EMAIL) {
    return (
      <div className="page">
        <div className="card" style={{ color: 'var(--text2)' }}>
          Accesso negato. Solo l'admin può vedere questa pagina.
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">Admin</h1>
          <p className="page-subtitle">Gestione rose e tornei</p>
        </div>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <TournamentsSection />
        <RosterSection />
      </div>
    </div>
  )
}

// ── Tournaments ────────────────────────────────────────────────
function TournamentsSection() {
  const [tournaments, setTournaments] = useState([])
  const [form, setForm] = useState({
    name: '', type: 'masters1000', start_date: '', end_date: '',
    total_rounds: 6, api_tournament_id: ''
  })
  const [msg,     setMsg]     = useState({ type: '', text: '' })
  const [syncing, setSyncing] = useState(null) // tournament id currently syncing

  useEffect(() => { loadTournaments() }, [])

  async function loadTournaments() {
    const { data } = await supabase.from('tournaments').select('*').order('start_date')
    setTournaments(data ?? [])
  }

  async function addTournament(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    const { error } = await supabase.from('tournaments').insert({
      ...form,
      total_rounds:      Number(form.total_rounds),
      api_tournament_id: form.api_tournament_id || null,
    })
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      setMsg({ type: 'success', text: `${form.name} aggiunto!` })
      setForm({ name: '', type: 'masters1000', start_date: '', end_date: '', total_rounds: 6, api_tournament_id: '' })
      loadTournaments()
    }
  }

  async function deleteTournament(id, name) {
    if (!confirm(`Eliminare ${name}?`)) return
    await supabase.from('tournaments').delete().eq('id', id)
    loadTournaments()
  }

  async function updateStatus(id, status) {
    await supabase.from('tournaments').update({ status }).eq('id', id)
    loadTournaments()
  }

  async function syncTournamentMatches(id, name) {
    if (!confirm(`Sincronizzare le partite di ${name}?\nQuesto scarica il tabellone dall'API.`)) return
    setSyncing(id)
    setMsg({ type: '', text: '' })
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-tournament`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ tournament_id: id }),
        }
      )
      const data = await res.json()
      const result = data.synced?.[0]
      if (result?.error) {
        setMsg({ type: 'error', text: `Errore: ${result.error}` })
      } else if (result?.skipped) {
        setMsg({ type: 'error', text: `Sync saltato: ${result.skipped}` })
      } else {
        setMsg({ type: 'success', text: `${name}: ${result?.matches_processed ?? 0} partite sincronizzate.` })
      }
    } catch (e) {
      setMsg({ type: 'error', text: `Errore di rete: ${e}` })
    }
    setSyncing(null)
  }

  return (
    <div className="card">
      <h2 className="admin-section-title display">Tornei</h2>

      <div className="admin-table-wrap">
        <table className="atp-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Inizio</th>
              <th>Fine</th>
              <th>Turni</th>
              <th>Status</th>
              <th>API ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tournaments.map(t => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  <span className={`badge ${t.type === 'slam' ? 'badge-slam' : 'badge-masters'}`}>
                    {t.type === 'slam' ? 'Slam' : 'M1000'}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{t.start_date}</td>
                <td className="mono" style={{ fontSize: 12 }}>{t.end_date}</td>
                <td className="mono">{t.total_rounds}</td>
                <td>
                  <select
                    className="input"
                    style={{ padding: '4px 8px', fontSize: 12, width: 'auto' }}
                    value={t.status}
                    onChange={e => updateStatus(t.id, e.target.value)}
                  >
                    <option value="upcoming">Upcoming</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                  </select>
                </td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {t.api_tournament_id ?? '—'}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => syncTournamentMatches(t.id, t.name)}
                    disabled={syncing === t.id}
                    title="Scarica tabellone dall'API"
                  >
                    {syncing === t.id ? '…' : '↻ Sync'}
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => deleteTournament(t.id, t.name)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg.text && (
        <div className={`${msg.type === 'error' ? 'error-msg' : 'success-msg'}`} style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      )}

      <div className="divider" />
      <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: 'var(--text2)' }}>
        Aggiungi torneo
      </h3>
      <form onSubmit={addTournament} className="admin-form">
        <div className="field">
          <label className="label">Nome</label>
          <input className="input" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Miami Open 2026" required />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label">Tipo</label>
            <select className="input" value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="masters1000">Masters 1000</option>
              <option value="slam">Slam</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Turni totali</label>
            <input className="input" type="number" value={form.total_rounds}
              onChange={e => setForm(f => ({ ...f, total_rounds: e.target.value }))}
              min={4} max={7} required />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label">Data inizio</label>
            <input className="input" type="date" value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} required />
          </div>
          <div className="field">
            <label className="label">Data fine</label>
            <input className="input" type="date" value={form.end_date}
              onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} required />
          </div>
        </div>
        <div className="field">
          <label className="label">
            API Tournament ID{' '}
            <span style={{ color: 'var(--text3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              (opzionale)
            </span>
          </label>
          <input className="input" value={form.api_tournament_id}
            onChange={e => setForm(f => ({ ...f, api_tournament_id: e.target.value }))}
            placeholder="es. 1456" />
        </div>
        <button type="submit" className="btn btn-primary">Aggiungi torneo</button>
      </form>
    </div>
  )
}

// ── Roster management ──────────────────────────────────────────
function RosterSection() {
  const [users,        setUsers]        = useState([])
  const [atpPlayers,   setAtpPlayers]   = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [roster,       setRoster]       = useState([])
  const [search,       setSearch]       = useState('')
  const [priceInput,   setPriceInput]   = useState('')
  const [msg,          setMsg]          = useState({ type: '', text: '' })
  const [credits,      setCredits]      = useState(100)

  useEffect(() => { loadUsers(); loadAtpPlayers() }, [])

  async function loadUsers() {
    const { data } = await supabase.from('profiles').select('*').order('username')
    setUsers(data ?? [])
  }

  async function loadAtpPlayers() {
    const { data } = await supabase.from('atp_players').select('*').order('ranking')
    setAtpPlayers(data ?? [])
  }

  async function selectUser(user) {
    setSelectedUser(user)
    setMsg({ type: '', text: '' })
    setSearch('')
    const { data } = await supabase
      .from('roster_players')
      .select('*, atp_players(*)')
      .eq('user_id', user.id)
      .order('atp_players(ranking)')
    setRoster(data ?? [])
    setCredits(user.credits_remaining)
  }

  async function addToRoster(player) {
    if (!selectedUser) return
    if (roster.length >= 10) {
      setMsg({ type: 'error', text: 'Questa rosa ha già 10 giocatori.' }); return
    }
    if (roster.find(r => r.atp_player_id === player.id)) {
      setMsg({ type: 'error', text: `${player.name} è già in rosa.` }); return
    }
    const price = priceInput !== '' ? Number(priceInput) : computePrice(player.ranking)
    if (isNaN(price) || price < 0) {
      setMsg({ type: 'error', text: 'Prezzo non valido.' }); return
    }
    const { error } = await supabase.from('roster_players').insert({
      user_id:       selectedUser.id,
      atp_player_id: player.id,
      price_paid:    price,
    })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    const newCredits = credits - price
    await supabase.from('profiles').update({ credits_remaining: newCredits }).eq('id', selectedUser.id)
    setCredits(newCredits)
    setUsers(u => u.map(u => u.id === selectedUser.id ? { ...u, credits_remaining: newCredits } : u))
    setPriceInput('')
    setSearch('')
    setMsg({ type: 'success', text: `${player.name} aggiunto per ${price} crediti.` })
    selectUser(selectedUser)
  }

  async function removeFromRoster(rosterEntry) {
    const name  = rosterEntry.atp_players?.name ?? 'il giocatore'
    const price = rosterEntry.price_paid
    if (!confirm(`Rimuovere ${name}? I ${price} crediti verranno restituiti.`)) return
    await supabase.from('roster_players').delete().eq('id', rosterEntry.id)
    const newCredits = credits + price
    await supabase.from('profiles').update({ credits_remaining: newCredits }).eq('id', selectedUser.id)
    setCredits(newCredits)
    setUsers(u => u.map(u => u.id === selectedUser.id ? { ...u, credits_remaining: newCredits } : u))
    selectUser(selectedUser)
  }

  const rosterIds   = new Set(roster.map(r => r.atp_player_id))
  const filteredAtp = search.trim().length >= 2
    ? atpPlayers.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && !rosterIds.has(p.id))
    : []

  return (
    <div className="card">
      <h2 className="admin-section-title display">Rose</h2>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
        Seleziona un giocatore per gestire la sua rosa dell'asta.
      </p>

      <div className="user-tabs">
        {users.map(u => (
          <button
            key={u.id}
            className={`user-tab ${selectedUser?.id === u.id ? 'active' : ''}`}
            onClick={() => selectUser(u)}
          >
            <span>{u.username}</span>
            <span className="user-tab-credits mono">{u.credits_remaining}cr</span>
          </button>
        ))}
      </div>

      {selectedUser && (
        <div className="roster-admin">
          {msg.text && (
            <div className={msg.type === 'error' ? 'error-msg' : 'success-msg'}>{msg.text}</div>
          )}
          <div className="roster-admin-grid">
            <div>
              <div className="admin-sub-label">
                Rosa attuale — {roster.length}/10 · {credits} crediti rimasti
              </div>
              {roster.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 8 }}>Nessun giocatore ancora.</p>
              )}
              <div className="roster-admin-list">
                {roster.map(r => {
                  const p = r.atp_players
                  return (
                    <div key={r.id} className="roster-admin-row">
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text2)', width: 28 }}>#{p?.ranking}</span>
                      <span style={{ flex: 1, fontSize: 14 }}>{p?.name}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>{r.price_paid}cr</span>
                      <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => removeFromRoster(r)}>✕</button>
                    </div>
                  )
                })}
              </div>
            </div>

            {roster.length < 10 && (
              <div>
                <div className="admin-sub-label">Aggiungi giocatore</div>
                <div className="field" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    placeholder="Cerca per nome (min. 2 caratteri)…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setMsg({ type: '', text: '' }) }}
                  />
                </div>
                <div className="field">
                  <label className="label">
                    Prezzo pagato all'asta{' '}
                    <span style={{ color: 'var(--text3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      (lascia vuoto = prezzo base)
                    </span>
                  </label>
                  <input className="input" type="number" min={0} placeholder="es. 14"
                    value={priceInput} onChange={e => setPriceInput(e.target.value)} />
                </div>
                {filteredAtp.length > 0 && (
                  <div className="player-search-results">
                    {filteredAtp.slice(0, 8).map(p => (
                      <button key={p.id} className="player-search-row" onClick={() => addToRoster(p)}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text2)', width: 28 }}>#{p.ranking}</span>
                        <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text2)' }}>base: {computePrice(p.ranking)}cr</span>
                      </button>
                    ))}
                  </div>
                )}
                {search.trim().length >= 2 && filteredAtp.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
                    Nessun risultato. Il giocatore potrebbe non essere nel DB.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

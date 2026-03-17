// src/pages/Schedule.jsx
// Pagina "Prossimi tornei" — calendario con countdown e info

import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import './Schedule.css'

function daysUntil(dateStr) {
  const now    = new Date()
  const target = new Date(dateStr)
  const diff   = Math.ceil((target - now) / (1000 * 60 * 60 * 24))
  return diff
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
}

function tournamentDuration(start, end) {
  const s = new Date(start)
  const e = new Date(end)
  const days = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1
  return `${days} giorni`
}

export default function Schedule() {
  const [tournaments, setTournaments] = useState([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tournaments')
        .select('*')
        .order('start_date')
      setTournaments(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="loading-screen">Caricamento…</div>

  const ongoing   = tournaments.filter(t => t.status === 'ongoing')
  const upcoming  = tournaments.filter(t => t.status === 'upcoming')
  const completed = tournaments.filter(t => t.status === 'completed')

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">Calendario</h1>
          <p className="page-subtitle">
            {upcoming.length} tornei in programma · {completed.length} completati
          </p>
        </div>
      </header>

      {/* ── In corso ── */}
      {ongoing.map(t => (
        <div key={t.id} className="tournament-card ongoing-card">
          <div className="tc-left">
            <div className="tc-status">
              <span className="badge badge-live">● In corso</span>
            </div>
            <div className="tc-name display">{t.name}</div>
            <div className="tc-dates">
              {formatDate(t.start_date)} — {formatDate(t.end_date)}
            </div>
          </div>
          <div className="tc-right">
            <div className="tc-type-badge">
              <span className={`badge ${t.type === 'slam' ? 'badge-slam' : 'badge-masters'}`}>
                {t.type === 'slam' ? 'Grand Slam' : 'Masters 1000'}
              </span>
            </div>
            <div className="tc-rounds mono">{t.total_rounds} turni</div>
          </div>
        </div>
      ))}

      {/* ── Prossimi ── */}
      {upcoming.length > 0 && (
        <>
          <div className="schedule-section-label">Prossimi tornei</div>
          <div className="schedule-list">
            {upcoming.map((t, i) => {
              const days = daysUntil(t.start_date)
              const isNext = i === 0
              return (
                <div key={t.id} className={`tournament-card ${isNext ? 'next-card' : ''}`}>
                  <div className="tc-left">
                    <div className="tc-status">
                      <span className={`badge ${t.type === 'slam' ? 'badge-slam' : 'badge-masters'}`}>
                        {t.type === 'slam' ? 'Grand Slam' : 'Masters 1000'}
                      </span>
                      {isNext && <span className="next-label">Prossimo</span>}
                    </div>
                    <div className="tc-name display">{t.name}</div>
                    <div className="tc-dates">
                      {formatDate(t.start_date)} — {formatDate(t.end_date)}
                      <span className="tc-duration">· {tournamentDuration(t.start_date, t.end_date)}</span>
                    </div>
                  </div>
                  <div className="tc-right">
                    <div className={`tc-countdown ${days <= 7 ? 'countdown-soon' : ''}`}>
                      <span className="countdown-num mono">{days > 0 ? days : 0}</span>
                      <span className="countdown-label">giorni</span>
                    </div>
                    <div className="tc-rounds mono">{t.total_rounds} turni</div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Completati ── */}
      {completed.length > 0 && (
        <>
          <div className="schedule-section-label" style={{ marginTop: 32 }}>Tornei completati</div>
          <div className="schedule-list">
            {[...completed].reverse().map(t => (
              <div key={t.id} className="tournament-card completed-card">
                <div className="tc-left">
                  <div className="tc-status">
                    <span className="badge badge-done">Completato</span>
                  </div>
                  <div className="tc-name display">{t.name}</div>
                  <div className="tc-dates">{formatDate(t.start_date)} — {formatDate(t.end_date)}</div>
                </div>
                <div className="tc-right">
                  <span className={`badge ${t.type === 'slam' ? 'badge-slam' : 'badge-masters'}`}>
                    {t.type === 'slam' ? 'Grand Slam' : 'Masters 1000'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tournaments.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text2)' }}>Nessun torneo in programma.</p>
        </div>
      )}
    </div>
  )
}

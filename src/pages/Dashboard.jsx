// src/pages/Dashboard.jsx — aggiornato con le rose di tutti
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getUserColorMap } from '../utils/userColors'
import './Dashboard.css'

function tournamentBadge(type, status) {
  if (status === 'ongoing')   return <span className="badge badge-live">● Live</span>
  if (status === 'completed') return <span className="badge badge-done">Fine</span>
  const cls = type === 'slam' ? 'badge-slam' : 'badge-masters'
  const lbl = type === 'slam' ? 'Slam' : 'Masters 1000'
  return <span className={`badge ${cls}`}>{lbl}</span>
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

export default function Dashboard({ session }) {
  const [leaderboard, setLeaderboard] = useState([])
  const [liveStandings, setLiveStandings] = useState([])
  const [tournaments, setTournaments] = useState([])
  const [allRosters,  setAllRosters]  = useState([])  // rose di tutti
  const [colorMap, setColorMap] = useState({})
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: lb }, { data: tv }, { data: rosters }] = await Promise.all([
        supabase.from('leaderboard').select('*'),
        supabase.from('tournaments').select('*').order('start_date'),
        // Rose di tutti gli utenti con giocatori
        supabase
          .from('roster_players')
          .select(`
            user_id, price_paid,
            atp_players ( id, name, ranking ),
            profiles ( username )
          `)
          .order('atp_players(ranking)'),
      ])
      setTournaments(tv ?? [])
      setColorMap(await getUserColorMap(supabase))

      // Fetch live points from ongoing tournament
      const { data: ongoingT } = await supabase
        .from('tournaments')
        .select('id')
        .eq('status', 'ongoing')
        .maybeSingle()

      if (ongoingT) {
        // Trigger an on-demand sync so live standings don't stay stale
        // when scheduled jobs are delayed.
        try {
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-tournament`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${session.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ tournament_id: ongoingT.id }),
          })
          if (!response.ok) {
            const details = await response.text()
            throw new Error(`sync-tournament failed (${response.status}): ${details}`)
          }
        } catch (e) {
          console.warn('sync-tournament on-demand failed:', e)
        }

        const { data: liveScores } = await supabase
          .rpc('compute_live_tournament_scores', {
            p_tournament_id: ongoingT.id
          })

        // Sum live points per user
        const liveByUser = {}
        ;(liveScores ?? []).forEach(s => {
          liveByUser[s.user_id] = (liveByUser[s.user_id] ?? 0) + (s.total_points ?? 0)
        })

        // Merge with leaderboard
        const merged = (lb ?? []).map(u => ({
          ...u,
          total_points: (u.total_points ?? 0) + (liveByUser[u.user_id] ?? 0),
          live_points: liveByUser[u.user_id] ?? 0,
        })).sort((a, b) => b.total_points - a.total_points)

        setLeaderboard(merged)
        setLiveStandings(merged)
      } else {
        setLeaderboard(lb ?? [])
        setLiveStandings(lb ?? [])
      }

      // Raggruppa rose per utente
      const byUser = {}
      ;(rosters ?? []).forEach(r => {
        const uid = r.user_id
        const username = r.profiles?.username ?? uid
        if (!byUser[uid]) byUser[uid] = { uid, username, players: [] }
        byUser[uid].players.push(r)
      })
      setAllRosters(Object.values(byUser))
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel(`dashboard-live-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_players' }, load)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session.user.id, session.access_token])

  const upcoming = tournaments.filter(t => t.status === 'upcoming').slice(0, 3)
  const ongoing  = tournaments.find(t  => t.status === 'ongoing')
  const standingsForView = liveStandings.length > 0 ? liveStandings : leaderboard
  const myRank   = standingsForView.findIndex(u => u.user_id === session.user.id) + 1
  const me       = standingsForView.find(u => u.user_id === session.user.id)

  if (loading) return <div className="loading-screen">Caricamento…</div>

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title display">Classifica</h1>
          <p className="page-subtitle">Stagione 2026 · {leaderboard.length} giocatori</p>
        </div>
        {me && (
          <div className="my-rank-chip">
            <span className="my-rank-pos mono">#{myRank}</span>
            <span className="my-rank-pts mono">{me.total_points} <small>pts</small></span>
          </div>
        )}
      </header>

      <div className="dashboard-grid">
        {/* ── Leaderboard ── */}
        <section>
          <div className="card">
            <div className="leaderboard-list">
              {leaderboard.length === 0 && (
                <p style={{ color: 'var(--text2)', fontSize: 13 }}>Nessun punto ancora. Forza!</p>
              )}
              {standingsForView.map((u, i) => {
                const isMe   = u.user_id === session.user.id
                const medals = ['🥇', '🥈', '🥉']
                const color  = colorMap[u.user_id]
                return (
                  <div key={u.user_id} className={`lb-row ${isMe ? 'lb-row-me' : ''}`}>
                    <div className="lb-pos mono">
                      {i < 3 ? medals[i] : <span className="lb-num">{i + 1}</span>}
                    </div>
                    <div className="lb-color-dot" style={{ background: color?.text }} />
                    <div className="lb-name">
                      {u.username}
                      {isMe && <span className="lb-you">tu</span>}
                    </div>
                    <div className="lb-right">
                      <span className="lb-pts mono">{u.total_points}</span>
                      <span className="lb-pts-label">pts</span>
                      {u.live_points > 0 && (
                        <span className="mono" style={{
                          fontSize: 10,
                          color: 'var(--accent)',
                          background: 'rgba(200,240,0,0.1)',
                          padding: '1px 6px',
                          borderRadius: '100px',
                          marginLeft: 4,
                          fontFamily: 'var(--font-mono)'
                        }}>
                          +{u.live_points} live
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Rose di tutti ── */}
          {allRosters.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h2 className="display" style={{ fontSize: 26, marginBottom: 14 }}>Rose</h2>
              <div className="all-rosters-grid">
                {allRosters.map((roster) => {
                  const color = colorMap[roster.uid]
                  const isMe  = roster.uid === session.user.id
                  return (
                    <div
                      key={roster.uid}
                      className="roster-card card card-sm"
                      style={{ borderColor: isMe ? color?.border : undefined }}
                    >
                      <div className="roster-card-header" style={{ borderColor: color?.border }}>
                        <div className="roster-dot" style={{ background: color?.text }} />
                        <span className="roster-username">{roster.username}</span>
                        {isMe && <span className="lb-you">tu</span>}
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
                          {roster.players.length}/10
                        </span>
                      </div>
                      <div className="roster-players-list">
                        {roster.players.map(r => (
                          <div key={r.atp_players?.id} className="roster-player-row">
                            <span className="mono" style={{ fontSize: 10, color: 'var(--text3)', width: 24 }}>
                              #{r.atp_players?.ranking}
                            </span>
                            <span style={{ fontSize: 13 }}>{r.atp_players?.name}</span>
                          </div>
                        ))}
                        {roster.players.length === 0 && (
                          <p style={{ fontSize: 12, color: 'var(--text3)' }}>Rosa non ancora compilata</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── Right column ── */}
        <aside className="dashboard-aside">
          {ongoing && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(200,240,0,0.2)' }}>
              <div className="section-label">In corso</div>
              <div className="tournament-highlight">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  {tournamentBadge(ongoing.type, ongoing.status)}
                </div>
                <div className="tournament-name display">{ongoing.name}</div>
                <div className="tournament-dates">
                  {formatDate(ongoing.start_date)} — {formatDate(ongoing.end_date)}
                </div>
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="card">
              <div className="section-label" style={{ marginBottom: 14 }}>Prossimi tornei</div>
              <div className="upcoming-list">
                {upcoming.map(t => (
                  <div key={t.id} className="upcoming-row">
                    <div className="upcoming-info">
                      {tournamentBadge(t.type, t.status)}
                      <span className="upcoming-name">{t.name}</span>
                    </div>
                    <span className="upcoming-date mono">{formatDate(t.start_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

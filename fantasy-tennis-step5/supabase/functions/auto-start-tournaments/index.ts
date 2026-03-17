// supabase/functions/auto-start-tournaments/index.ts
//
// Gira ogni mattina alle 7:00 UTC.
// 1. Se oggi è la start_date di un torneo → status = 'ongoing' (trigger SQL bloccherà le picks)
// 2. Se domani è la start_date → manda email reminder a tutti i 4 giocatori
// 3. Se oggi è dopo la end_date di un torneo ongoing → status = 'completed' + calcola punteggi

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'fantatennis@tuodominio.com'
const SITE_URL       = Deno.env.get('SITE_URL') ?? 'https://fantasy-tennis.vercel.app'

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const today    = new Date()
  const todayStr = today.toISOString().slice(0, 10)       // YYYY-MM-DD

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const log: string[] = []

  // ── 1. Avvia tornei che iniziano oggi ─────────────────────
  const { data: toStart } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'upcoming')
    .eq('start_date', todayStr)

  for (const t of toStart ?? []) {
    await supabase
      .from('tournaments')
      .update({ status: 'ongoing' })
      .eq('id', t.id)
    // Il trigger SQL on_tournament_started blocca le picks e congela i moltiplicatori
    log.push(`Started: ${t.name}`)
  }

  // ── 2. Manda reminder per tornei che iniziano domani ──────
  const { data: tomorrow_t } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'upcoming')
    .eq('start_date', tomorrowStr)

  for (const t of tomorrow_t ?? []) {
    // Carica tutti gli utenti
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')

    // Carica le picks già fatte per questo torneo
    const { data: existingPicks } = await supabase
      .from('picks')
      .select('user_id')
      .eq('tournament_id', t.id)

    const pickedUserIds = new Set((existingPicks ?? []).map(p => p.user_id))

    // Carica le email da auth.users tramite service role
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers()

    for (const profile of profiles ?? []) {
      const authUser  = authUsers.find(u => u.id === profile.id)
      const email     = authUser?.email
      if (!email) continue

      const hasPicks  = pickedUserIds.has(profile.id)
      await sendReminderEmail(email, profile.username, t, hasPicks)
      log.push(`Email sent to ${profile.username} for ${t.name} (picks: ${hasPicks})`)
    }
  }

  // ── 3. Completa tornei finiti ─────────────────────────────
  const { data: toComplete } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'ongoing')
    .lt('end_date', todayStr)   // end_date < oggi → finito

  for (const t of toComplete ?? []) {
    await supabase
      .from('tournaments')
      .update({ status: 'completed' })
      .eq('id', t.id)

    await supabase.rpc('compute_tournament_scores', { p_tournament_id: t.id })
    log.push(`Completed + scored: ${t.name}`)

    // Email risultati finali
    await sendResultsEmail(supabase, t)
  }

  return new Response(
    JSON.stringify({ date: todayStr, log }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

// ── Email reminder pre-torneo ──────────────────────────────────
async function sendReminderEmail(
  to: string,
  username: string,
  tournament: { name: string; start_date: string; type: string },
  hasPicks: boolean,
) {
  const tournamentType = tournament.type === 'slam' ? 'Grand Slam 🎾' : 'Masters 1000'
  const picksCta = hasPicks
    ? `<p style="color:#7C7970">✅ Hai già fatto le tue scelte per questo torneo.</p>`
    : `<p><a href="${SITE_URL}/picks" style="background:#C8F000;color:#0C0C0D;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;display:inline-block">👉 Schiera i tuoi giocatori</a></p>`

  const html = `
    <div style="background:#0C0C0D;color:#F0EBE1;font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;border-radius:12px">
      <div style="font-size:22px;font-weight:700;margin-bottom:4px;letter-spacing:0.03em">
        Fanta<span style="color:#C8F000">Tennis</span>
      </div>
      <hr style="border:none;border-top:1px solid #232328;margin:16px 0">
      <p style="color:#7C7970;font-size:13px;text-transform:uppercase;letter-spacing:0.08em">Reminder torneo</p>
      <h1 style="font-size:28px;margin:4px 0 8px;line-height:1.2">${tournament.name}</h1>
      <p style="color:#C8F000;font-size:13px">${tournamentType} · inizia domani</p>
      <hr style="border:none;border-top:1px solid #232328;margin:20px 0">
      <p>Ciao <strong>${username}</strong>! 👋</p>
      <p>Il torneo <strong>${tournament.name}</strong> inizia <strong>domani</strong>. Ricorda che una volta avviato non potrai più cambiare i tuoi schieramenti.</p>
      ${picksCta}
      <hr style="border:none;border-top:1px solid #232328;margin:20px 0">
      <p style="font-size:11px;color:#4A4A50">FantaTennis · <a href="${SITE_URL}" style="color:#4A4A50">${SITE_URL}</a></p>
    </div>
  `

  await sendEmail(to, `⚡ ${tournament.name} inizia domani — schiera i tuoi giocatori!`, html)
}

// ── Email risultati finali ─────────────────────────────────────
async function sendResultsEmail(
  supabase: ReturnType<typeof createClient>,
  tournament: { id: string; name: string; type: string },
) {
  const { data: lb } = await supabase.from('leaderboard').select('*')
  if (!lb || lb.length === 0) return

  const { data: { users: authUsers } } = await supabase.auth.admin.listUsers()

  // Costruisci tabella classifica
  const rows = lb.map((u, i) => {
    const medals = ['🥇', '🥈', '🥉']
    const pos    = i < 3 ? medals[i] : `#${i + 1}`
    return `<tr style="border-bottom:1px solid #232328">
      <td style="padding:8px 12px;font-size:18px">${pos}</td>
      <td style="padding:8px 12px">${u.username}</td>
      <td style="padding:8px 12px;font-family:monospace;color:#C8F000">${u.total_points} pts</td>
    </tr>`
  }).join('')

  const html = `
    <div style="background:#0C0C0D;color:#F0EBE1;font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;border-radius:12px">
      <div style="font-size:22px;font-weight:700;margin-bottom:4px">
        Fanta<span style="color:#C8F000">Tennis</span>
      </div>
      <hr style="border:none;border-top:1px solid #232328;margin:16px 0">
      <p style="color:#7C7970;font-size:13px;text-transform:uppercase;letter-spacing:0.08em">Torneo completato</p>
      <h1 style="font-size:28px;margin:4px 0 16px">${tournament.name}</h1>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid #232328">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#7C7970;text-transform:uppercase">#</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#7C7970;text-transform:uppercase">Giocatore</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#7C7970;text-transform:uppercase">Punti stagione</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <hr style="border:none;border-top:1px solid #232328;margin:20px 0">
      <a href="${SITE_URL}/storico" style="background:#C8F000;color:#0C0C0D;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;display:inline-block">
        Vedi i dettagli →
      </a>
      <hr style="border:none;border-top:1px solid #232328;margin:20px 0">
      <p style="font-size:11px;color:#4A4A50">FantaTennis · <a href="${SITE_URL}" style="color:#4A4A50">${SITE_URL}</a></p>
    </div>
  `

  // Manda a tutti
  for (const u of lb) {
    const authUser = authUsers.find(a => a.id === u.user_id)
    if (authUser?.email) {
      await sendEmail(
        authUser.email,
        `🏆 ${tournament.name} — classifica aggiornata`,
        html,
      )
    }
  }
}

// ── Resend helper ──────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED - no RESEND_API_KEY] To: ${to} | Subject: ${subject}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) {
    console.error(`Resend error: ${res.status}`, await res.text())
  }
}

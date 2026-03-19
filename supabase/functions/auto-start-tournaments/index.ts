// supabase/functions/auto-start-tournaments/index.ts
// Gira ogni mattina alle 7:00 UTC.
// 0. Se start_date è tra 2 giorni → pre-sync tabellone (incluse qualificazioni)
// 1. Se domani è start_date → email reminder a tutti
// 2. Se oggi è start_date → aggiorna ranking ATP, poi avvia torneo
//    (il trigger SQL congelerà i moltiplicatori con i ranking freschi)
// 3. Se end_date è passata → completa torneo + calcola punteggi + email risultati

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

  const today       = new Date()
  const todayStr    = today.toISOString().slice(0, 10)
  const tomorrow    = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  const in2days     = new Date(today)
  in2days.setDate(in2days.getDate() + 2)
  const in2daysStr  = in2days.toISOString().slice(0, 10)

  const log: string[] = []

  // ── 0. Pre-sync tabellone per tornei che iniziano tra 2 giorni ──
  const { data: upcomingSoon } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'upcoming')
    .eq('start_date', in2daysStr)

  for (const t of upcomingSoon ?? []) {
    if (!t.api_tournament_id) {
      log.push(`Pre-sync skipped (no api_id): ${t.name}`)
      continue
    }

    try {
      const res = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-tournament`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ tournament_id: t.id }),
        }
      )

      let data: any = {}
      try {
        const text = await res.text()
        if (text && text.length > 0) data = JSON.parse(text)
      } catch (e) {
        log.push(`Pre-sync ${t.name}: response parse error — ${e}`)
        continue
      }
      log.push(`Pre-sync ${t.name}: ${JSON.stringify(data.synced?.[0] ?? data)}`)
    } catch (e) {
      log.push(`Pre-sync failed (${t.name}): ${e}`)
    }
  }

  // ── 1. Email reminder per tornei che iniziano domani ──────
  const { data: tomorrowTournaments } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'upcoming')
    .eq('start_date', tomorrowStr)

  for (const t of tomorrowTournaments ?? []) {
    const { data: profiles } = await supabase.from('profiles').select('id, username')
    const { data: existingPicks } = await supabase
      .from('picks').select('user_id').eq('tournament_id', t.id)
    const pickedUserIds = new Set((existingPicks ?? []).map((p: any) => p.user_id))
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers()

    for (const profile of profiles ?? []) {
      const authUser = (authUsers as any[]).find(u => u.id === profile.id)
      if (!authUser?.email) continue
      const hasPicks = pickedUserIds.has(profile.id)
      await sendReminderEmail(authUser.email, profile.username, t, hasPicks)
      log.push(`Reminder → ${profile.username} (picks: ${hasPicks})`)
    }
  }

  // ── 2. Avvia tornei che iniziano oggi ─────────────────────
  const { data: toStart } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'upcoming')
    .eq('start_date', todayStr)

  for (const t of toStart ?? []) {
    // Prima aggiorna i ranking, poi avvia il torneo —
    // così il trigger congela i moltiplicatori con i dati freschi
    try {
      const rankRes = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-rankings`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type':  'application/json',
          },
          body: '{}',
        }
      )
      const rankData = await rankRes.json()
      log.push(`Rankings synced: ${rankData.updated_players ?? '?'} players`)
    } catch (e) {
      log.push(`Warning: ranking sync failed (${e}) — proceeding anyway`)
    }

    await supabase.from('tournaments').update({ status: 'ongoing' }).eq('id', t.id)
    log.push(`Started: ${t.name}`)
  }

  // ── 3. Completa tornei con end_date passata ───────────────
  const { data: toComplete } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'ongoing')
    .lt('end_date', todayStr)

  for (const t of toComplete ?? []) {
    await supabase.from('tournaments').update({ status: 'completed' }).eq('id', t.id)
    await supabase.rpc('compute_tournament_scores', { p_tournament_id: t.id })
    log.push(`Completed + scored: ${t.name}`)
    await sendResultsEmail(supabase, t)
    log.push(`Results email sent for: ${t.name}`)
  }

  return new Response(
    JSON.stringify({ date: todayStr, log }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

async function sendReminderEmail(
  to: string,
  username: string,
  tournament: { name: string; type: string },
  hasPicks: boolean,
) {
  const typeLabel = tournament.type === 'slam' ? 'Grand Slam 🎾' : 'Masters 1000'
  const picksCta  = hasPicks
    ? `<p style="color:#7C7970">✅ Hai già fatto le tue scelte per questo torneo.</p>`
    : `<p style="margin-top:20px"><a href="${SITE_URL}/picks" style="background:#C8F000;color:#0C0C0D;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;display:inline-block">👉 Schiera i tuoi giocatori</a></p>`

  const html = `
    <div style="background:#0C0C0D;color:#F0EBE1;font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;border-radius:12px">
      <div style="font-size:22px;font-weight:700;margin-bottom:4px">Fanta<span style="color:#C8F000">Tennis</span></div>
      <hr style="border:none;border-top:1px solid #232328;margin:16px 0">
      <p style="color:#7C7970;font-size:13px;text-transform:uppercase;letter-spacing:0.08em">Reminder torneo</p>
      <h1 style="font-size:28px;margin:4px 0 8px">${tournament.name}</h1>
      <p style="color:#C8F000;font-size:13px">${typeLabel} · inizia domani</p>
      <hr style="border:none;border-top:1px solid #232328;margin:20px 0">
      <p>Ciao <strong>${username}</strong>! 👋</p>
      <p>Il torneo <strong>${tournament.name}</strong> inizia <strong>domani</strong>. Una volta avviato non potrai più modificare i tuoi schieramenti.</p>
      ${picksCta}
      <hr style="border:none;border-top:1px solid #232328;margin:20px 0">
      <p style="font-size:11px;color:#4A4A50">FantaTennis · <a href="${SITE_URL}" style="color:#4A4A50">${SITE_URL}</a></p>
    </div>
  `
  await sendEmail(to, `⚡ ${tournament.name} inizia domani — schiera i tuoi giocatori!`, html)
}

async function sendResultsEmail(
  supabase: ReturnType<typeof createClient>,
  tournament: { id: string; name: string; type: string },
) {
  const { data: lb } = await supabase.from('leaderboard').select('*')
  if (!lb || lb.length === 0) return

  const { data: { users: authUsers } } = await supabase.auth.admin.listUsers()
  const medals = ['🥇', '🥈', '🥉']
  const rows   = (lb as any[]).map((u, i) => `
    <tr style="border-bottom:1px solid #232328">
      <td style="padding:10px 12px;font-size:18px">${i < 3 ? medals[i] : '#' + (i + 1)}</td>
      <td style="padding:10px 12px">${u.username}</td>
      <td style="padding:10px 12px;font-family:monospace;color:#C8F000;font-weight:500">${u.total_points} pts</td>
    </tr>`).join('')

  const html = `
    <div style="background:#0C0C0D;color:#F0EBE1;font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;border-radius:12px">
      <div style="font-size:22px;font-weight:700;margin-bottom:4px">Fanta<span style="color:#C8F000">Tennis</span></div>
      <hr style="border:none;border-top:1px solid #232328;margin:16px 0">
      <p style="color:#7C7970;font-size:13px;text-transform:uppercase;letter-spacing:0.08em">Torneo completato</p>
      <h1 style="font-size:28px;margin:4px 0 16px">${tournament.name}</h1>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead>
          <tr style="border-bottom:1px solid #232328">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#7C7970;text-transform:uppercase">#</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#7C7970;text-transform:uppercase">Giocatore</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#7C7970;text-transform:uppercase">Punti totali</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${SITE_URL}/storico" style="background:#C8F000;color:#0C0C0D;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;display:inline-block">Vedi dettagli →</a>
      <hr style="border:none;border-top:1px solid #232328;margin:24px 0">
      <p style="font-size:11px;color:#4A4A50">FantaTennis · <a href="${SITE_URL}" style="color:#4A4A50">${SITE_URL}</a></p>
    </div>
  `

  for (const u of lb as any[]) {
    const authUser = (authUsers as any[]).find(a => a.id === u.user_id)
    if (authUser?.email) {
      await sendEmail(authUser.email, `🏆 ${tournament.name} — classifica aggiornata`, html)
    }
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED] To: ${to} | Subject: ${subject}`)
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
  if (!res.ok) console.error(`Resend error ${res.status}:`, await res.text())
}

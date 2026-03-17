# Step 5 — Automazione calendario + email

Questo step aggiunge:
- **`sync-schedule`** — scarica il calendario ATP dall'API ogni settimana
- **`auto-start-tournaments`** — ogni mattina avvia i tornei, manda email reminder e completa i tornei finiti
- **Email** via Resend (gratuito, 3000 email/mese)
- **Seed calendario 2026** completo — tutti gli Slam e Masters 1000

---

## 1. Seed immediato del calendario

Esegui subito `seed_calendar_2026.sql` nel Supabase SQL Editor. Questo aggiunge tutti i tornei 2026 e li vedrai subito nella pagina **Calendario** del sito.

> ⚠️ Se vedi un errore `duplicate key` sul nome del torneo, significa che lo hai già — puoi ignorarlo o rimuovere quella riga dal seed.

---

## 2. Configura Resend per le email

1. Vai su [resend.com](https://resend.com) e crea un account gratuito
2. Vai su **API Keys → Create API Key** e copiala
3. Vai su **Domains** e aggiungi il tuo dominio (o usa il dominio sandbox per i test)

> 💡 **Per i test senza dominio**: Resend ha un dominio sandbox `onboarding@resend.dev` — puoi usarlo per mandare email solo alla tua email registrata su Resend. Perfetto per testare prima del deploy.

### Aggiungi i secret a Supabase

**Supabase Dashboard → Edge Functions → Secrets**, aggiungi:

```
RESEND_API_KEY   = re_xxxxxxxxxxxx        (la tua chiave Resend)
FROM_EMAIL       = fantatennis@tuodominio.com
SITE_URL         = https://fantasy-tennis.vercel.app
```

---

## 3. Deploya le nuove Edge Functions

Dalla cartella del progetto:

```bash
# Copia le funzioni nelle cartelle giuste
mkdir -p supabase/functions/sync-schedule
mkdir -p supabase/functions/auto-start-tournaments

# Poi copia i file index.ts e deploya
supabase functions deploy sync-schedule
supabase functions deploy auto-start-tournaments
```

---

## 4. Aggiungi i cron job

Apri `migration_step5.sql`, sostituisci:
- `YOUR_PROJECT_ID` → il tuo project ID Supabase (`qhibnmwaqfcedbrakcml`)
- `YOUR_SERVICE_ROLE_KEY` → la tua service role key `eyJ...`

Poi esegui il file nel SQL Editor.

---

## 5. Test manuale

Per testare subito `auto-start-tournaments` senza aspettare il cron:

```bash
supabase functions invoke auto-start-tournaments --no-verify-jwt
```

Controlla la risposta — vedrai nel campo `log` cosa ha fatto (tornei avviati, email inviate, ecc.).

Per testare `sync-schedule`:

```bash
supabase functions invoke sync-schedule --no-verify-jwt
```

---

## Flusso completo automatizzato

```
Ogni lunedì 6:00 UTC
  └─→ sync-schedule
        └─→ Aggiorna calendario tornei dall'API ATP

Ogni mattina 7:00 UTC
  └─→ auto-start-tournaments
        ├─→ Torna domani = start_date di un torneo?
        │     └─→ Manda email reminder a tutti ("schiera i tuoi giocatori!")
        ├─→ Oggi = start_date di un torneo?
        │     └─→ status = 'ongoing'
        │           └─→ Trigger SQL: blocca picks + congela moltiplicatori
        └─→ Torneo ongoing con end_date passata?
              └─→ status = 'completed'
                    ├─→ compute_tournament_scores()
                    └─→ Manda email risultati a tutti

Ogni ora 6-23 UTC (già attivo dallo step 3)
  └─→ sync-tournament
        └─→ Aggiorna partite e risultati dall'API
```

---

## Email che ricevete

**Il giorno prima del torneo:**
> ⚡ Miami Open 2026 inizia domani — schiera i tuoi giocatori!
> 
> Con bottone diretto alla pagina schieramenti (o conferma se hai già schierato)

**A torneo completato:**
> 🏆 Miami Open 2026 — classifica aggiornata
>
> Con tabella classifica stagionale e link allo storico

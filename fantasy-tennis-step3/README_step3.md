# Step 3 — Sincronizzazione automatica dei risultati

Questo step aggiunge:
- **2 Edge Functions** Supabase (Deno/TypeScript) per sync risultati e ranking
- **pg_cron** per invocarle automaticamente ogni ora / ogni giorno
- **Componente React** `TournamentStatus` con risultati live e highlight dei tuoi giocatori
- **Trigger SQL** che blocca automaticamente le picks quando il torneo inizia

---

## 1. Ottieni la chiave API-Tennis

1. Vai su [rapidapi.com](https://rapidapi.com)
2. Cerca **"API-Tennis"** (provider: sportcontentapi)
3. Abbonati al piano **Basic (gratuito)** — 100 richieste/giorno, sufficiente per tornei settimanali
4. Copia la tua **X-RapidAPI-Key** dal dashboard

> 💡 Con 100 req/giorno e sync ogni ora dalle 6:00 alle 23:00 = 17 chiamate/giorno per torneo.
> Se hai 2 tornei contemporanei, passa al piano Pro ($5/mese, 500 req/giorno).

---

## 2. Aggiungi il secret RAPIDAPI_KEY a Supabase

Nel Supabase Dashboard → **Edge Functions → Secrets**:

```
RAPIDAPI_KEY = la_tua_chiave_da_rapidapi
```

I secret `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vengono iniettati automaticamente da Supabase.

---

## 3. Esegui la migration SQL

Nel **Supabase SQL Editor**, esegui il file `migration_step3.sql`.

Prima però sostituisci i placeholder con i tuoi valori reali (li trovi in Project Settings → API):

```sql
alter database postgres set app.supabase_url     = 'https://TUOID.supabase.co';
alter database postgres set app.service_role_key = 'eyJhbGci...';
```

Poi esegui tutto il file. Questo:
- Crea la funzione `refresh_pick_multipliers()`
- Crea il trigger `tournament_started` (auto-lock picks)
- Attiva `pg_cron` e schedula i 2 job automatici

---

## 4. Deploya le Edge Functions

Installa la Supabase CLI se non ce l'hai:

```bash
npm install -g supabase
```

Collegati al tuo progetto:

```bash
supabase login
supabase link --project-ref TUO_PROJECT_ID
```

Deploya entrambe le funzioni:

```bash
supabase functions deploy sync-tournament
supabase functions deploy sync-rankings
```

---

## 5. Collega i tournament_id dell'API ai tuoi tornei

L'API-Tennis usa ID numerici propri. Devi trovarli e salvarli nel DB.

### Come trovare gli ID:

Chiama questo endpoint una volta (puoi farlo da browser con l'extension RapidAPI):

```
GET https://api-tennis.p.rapidapi.com/tournaments?type=ATP
```

Cerca i tornei della stagione 2025 nella risposta e prendi i loro `id`.

### Salvali nel DB:

```sql
-- Esempio
update public.tournaments set api_tournament_id = '1311'
where name = 'Australian Open 2025';

update public.tournaments set api_tournament_id = '1456'
where name = 'Roland Garros 2025';

-- ... e così via per tutti i tornei
```

---

## 6. Aggiungi TournamentStatus alla Dashboard

Copia i file `TournamentStatus.jsx` e `TournamentStatus.css` in `src/components/`, poi in `Dashboard.jsx`:

```jsx
// In cima al file
import TournamentStatus from '../components/TournamentStatus'

// Dentro il JSX, dopo il leaderboard (se c'è un torneo ongoing):
{ongoing && (
  <TournamentStatus
    session={session}
    tournament={ongoing}
  />
)}
```

---

## 7. Test manuale

Per testare senza aspettare il cron, chiama la funzione direttamente:

```bash
supabase functions invoke sync-tournament --no-verify-jwt
```

Oppure via curl:

```bash
curl -X POST https://TUO_ID.supabase.co/functions/v1/sync-tournament \
  -H "Authorization: Bearer TUO_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Flusso completo end-to-end

```
pg_cron ogni ora
    └─→ sync-tournament Edge Function
            ├─→ API-Tennis: fetch matches
            ├─→ upsert matches + match_players nel DB
            └─→ se torneo finito:
                    ├─→ tournaments.status = 'completed'
                    ├─→ picks.locked = true
                    └─→ compute_tournament_scores() ✓

pg_cron ogni mattina
    └─→ sync-rankings Edge Function
            ├─→ API-Tennis: fetch ATP top 100
            ├─→ upsert atp_players (ranking, price)
            └─→ refresh_pick_multipliers() (solo picks non bloccate)

Supabase Realtime (frontend)
    └─→ subscription su match_players
            └─→ TournamentStatus si aggiorna in automatico ✓
```

---

## Prossimi step

- [ ] **Step 4**: Visualizzazione bracket torneo (tabellone)
- [ ] **Step 5**: Pagina storico con dettaglio punteggi per torneo
- [ ] **Step 6**: Notifiche email quando un tuo giocatore avanza

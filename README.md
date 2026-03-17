# FantaTennis 🎾

Fantasy tennis per 4 amici — Slam e Masters 1000, asta iniziale, moltiplicatori per ranking, capitano.

---

## Stack

- **Frontend**: React + Vite
- **Hosting**: Vercel o Netlify (gratuito)
- **Database + Auth**: Supabase (gratuito)
- **Dati tennistici**: API-Tennis via RapidAPI (step successivo)

---

## Setup in 5 passi

### 1. Clona e installa

```bash
git clone <tuo-repo>
cd fantasy-tennis
npm install
```

### 2. Configura Supabase

Copia il file env e inserisci le tue credenziali:

```bash
cp .env.example .env.local
```

Apri `.env.local` e incolla i valori che trovi in:
**Supabase Dashboard → Project Settings → API**

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

### 3. Esegui lo schema SQL

Nel **Supabase SQL Editor**, esegui il file `schema.sql` (già fornito nel passo 1).

### 4. Popola i giocatori ATP

Nel Supabase SQL Editor, esegui questo per inserire i top 10 ATP (poi completa con i 100):

```sql
insert into public.atp_players (name, ranking, price) values
  ('Jannik Sinner',       1,  10),
  ('Carlos Alcaraz',      2,  10),
  ('Novak Djokovic',      3,  10),
  ('Alexander Zverev',    4,   9),
  ('Daniil Medvedev',     5,   9),
  ('Casper Ruud',         6,   9),
  ('Andrey Rublev',       7,   9),
  ('Hubert Hurkacz',      8,   9),
  ('Grigor Dimitrov',     9,   9),
  ('Alex Bublik',        10,   9),
  ('Taylor Fritz',       11,   9),
  ('Tommy Paul',         12,   9),
  ('Stefanos Tsitsipas', 13,   9),
  ('Ben Shelton',        14,   9),
  ('Holger Rune',        15,   9),
  ('Frances Tiafoe',     16,   9),
  ('Sebastian Korda',    17,   9),
  ('Felix Auger-Aliassime', 18, 9),
  ('Ugo Humbert',        19,   9),
  ('Alejandro Davidovich Fokina', 20, 8)
-- continua fino a ranking 100...
;
```

> 💡 **Prezzo formula**: `ceil((100 - ranking) / 10)` — già nel file `schema.sql` come funzione `compute_player_price(ranking)`.

### 5. Avvia in locale

```bash
npm run dev
```

Apri [http://localhost:5173](http://localhost:5173)

---

## Flusso di gioco

### Prima della stagione — Asta
1. Tutti e 4 i giocatori si registrano sul sito
2. Fate l'asta "offline" (vocale/chat) e poi un admin inserisce i roster nel database:

> Se ricevi l'errore `new row violates row-level security policy for table "roster_players"`, esegui prima la migration `supabase/migrations/20260317172000_fix_admin_rls_rosters.sql` nel SQL Editor di Supabase.

```sql
-- Esempio: assegna Alcaraz all'utente con email "mario@email.com"
insert into public.roster_players (user_id, atp_player_id, price_paid)
values (
  (select id from auth.users where email = 'mario@email.com'),
  (select id from public.atp_players where name = 'Carlos Alcaraz'),
  10  -- crediti pagati
);
-- Aggiorna i crediti rimasti
update public.profiles
set credits_remaining = credits_remaining - 10
where id = (select id from auth.users where email = 'mario@email.com');
```

### Prima di ogni torneo — Schieramenti
1. Ogni giocatore va su **Schiera** e seleziona 3 giocatori + capitano
2. Le scelte si possono modificare fino a quando il torneo non passa a `'ongoing'`

### Durante il torneo — Aggiornamento risultati (Step 3)
Il prossimo step costruirà una **Supabase Edge Function** che:
- Interroga l'API tennistica ogni ora
- Aggiorna `matches` e `match_players` automaticamente
- Calcola i punti chiamando `compute_tournament_scores(tournament_id)`

### Blocco scelte — da fare manualmente (per ora)
Quando il torneo inizia, esegui:
```sql
update public.tournaments set status = 'ongoing' where name = 'Australian Open 2025';
update public.picks set locked = true
where tournament_id = (select id from public.tournaments where name = 'Australian Open 2025');
```

---

## Deploy su Vercel

```bash
npm install -g vercel
vercel
```

Aggiungi le variabili d'ambiente nel dashboard Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Struttura del progetto

```
src/
├── pages/
│   ├── Login.jsx       # Accesso / registrazione
│   ├── Dashboard.jsx   # Classifica stagionale + tornei
│   ├── MyTeam.jsx      # Rosa personale + tabella ATP
│   └── Picks.jsx       # Schieramento pre-torneo
├── components/
│   └── Layout.jsx      # Sidebar + navigazione
├── supabase.js         # Client Supabase
├── App.jsx             # Router + auth guard
└── index.css           # Design system globale
```

---

## Prossimi step

- [ ] **Step 3**: Supabase Edge Function per sync automatico risultati via API
- [ ] **Step 4**: Visualizzazione tabellone torneo (bracket)
- [ ] **Step 5**: Pagina storico punteggi per torneo
- [ ] **Step 6**: Notifiche (email o push) quando un tuo giocatore vince un match

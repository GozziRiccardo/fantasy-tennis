-- ============================================================
-- FANTASY TENNIS — Calendario completo 2026
-- Tutti gli Slam e Masters 1000 della stagione
-- Esegui nel Supabase SQL Editor
-- ============================================================

insert into public.tournaments (name, type, start_date, end_date, total_rounds, status)
values
  -- ── Grand Slam ────────────────────────────────────────────
  ('Australian Open 2026',         'slam',        '2026-01-12', '2026-01-25', 7, 'completed'),
  ('Roland Garros 2026',           'slam',        '2026-05-24', '2026-06-07', 7, 'upcoming'),
  ('Wimbledon 2026',               'slam',        '2026-06-29', '2026-07-12', 7, 'upcoming'),
  ('US Open 2026',                 'slam',        '2026-08-24', '2026-09-06', 7, 'upcoming'),

  -- ── Masters 1000 ──────────────────────────────────────────
  -- Miami già inserito nello step 3b, lo saltiamo
  ('Indian Wells Masters 2026',    'masters1000', '2026-03-05', '2026-03-15', 6, 'completed'),
  ('Monte-Carlo Masters 2026',     'masters1000', '2026-04-12', '2026-04-19', 6, 'upcoming'),
  ('Madrid Open 2026',             'masters1000', '2026-04-26', '2026-05-10', 6, 'upcoming'),
  ('Italian Open 2026',            'masters1000', '2026-05-11', '2026-05-24', 6, 'upcoming'),
  ('Canadian Open 2026',           'masters1000', '2026-07-27', '2026-08-09', 6, 'upcoming'),
  ('Cincinnati Masters 2026',      'masters1000', '2026-08-10', '2026-08-16', 6, 'upcoming'),
  ('Shanghai Masters 2026',        'masters1000', '2026-10-05', '2026-10-18', 6, 'upcoming'),
  ('Paris Masters 2026',           'masters1000', '2026-10-26', '2026-11-01', 6, 'upcoming')

on conflict (name) do update
  set
    start_date   = excluded.start_date,
    end_date     = excluded.end_date,
    total_rounds = excluded.total_rounds;

-- Nota: Australian Open e Indian Wells sono segnati come 'completed'
-- perché si giocano prima del Miami Open (il nostro primo torneo attivo).
-- Aggiorna lo status se necessario.

-- Verifica:
-- select name, type, start_date, end_date, status from public.tournaments order by start_date;

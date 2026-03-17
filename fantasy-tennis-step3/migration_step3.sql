-- ============================================================
-- FANTASY TENNIS — Step 3 SQL migration
-- Run this in Supabase SQL Editor AFTER the base schema.sql
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. REFRESH PICK MULTIPLIERS
-- Called after a ranking update. Only touches unlocked picks
-- so that locked picks (tournament started) keep their frozen
-- multiplier — which is correct per the game rules.
-- ────────────────────────────────────────────────────────────
create or replace function public.refresh_pick_multipliers()
returns void language plpgsql as $$
begin
  update public.picks p
  set multiplier = ceil(a.ranking::numeric / 5)
  from public.atp_players a
  where a.id = p.atp_player_id
    and p.locked = false;
end;
$$;


-- ────────────────────────────────────────────────────────────
-- 2. LOCK PICKS WHEN TOURNAMENT GOES LIVE
-- Trigger: when a tournament's status changes to 'ongoing',
-- automatically lock all picks for that tournament and
-- snapshot the multipliers from current rankings.
-- ────────────────────────────────────────────────────────────
create or replace function public.on_tournament_started()
returns trigger language plpgsql as $$
begin
  if new.status = 'ongoing' and old.status = 'upcoming' then
    -- Snapshot multipliers at lock time
    update public.picks p
    set
      multiplier = ceil(a.ranking::numeric / 5),
      locked     = true
    from public.atp_players a
    where a.id      = p.atp_player_id
      and p.tournament_id = new.id;
  end if;
  return new;
end;
$$;

create trigger tournament_started
  after update of status on public.tournaments
  for each row
  execute procedure public.on_tournament_started();


-- ────────────────────────────────────────────────────────────
-- 3. SCHEDULED JOBS via pg_cron
-- Enable pg_cron extension first (Supabase: Database → Extensions → pg_cron)
-- ────────────────────────────────────────────────────────────

-- Enable the extension (run once)
create extension if not exists pg_cron;
grant usage on schema cron to postgres;

-- Job 1: Sync tournament matches every hour during tournament hours
-- (6:00 AM – midnight UTC, which covers all time zones for tennis)
select cron.schedule(
  'sync-tournament-matches',          -- job name
  '0 6-23 * * *',                     -- every hour from 6am to 11pm UTC
  $$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/sync-tournament',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- Job 2: Sync ATP rankings every morning at 4:00 AM UTC
select cron.schedule(
  'sync-atp-rankings',
  '0 4 * * *',
  $$
    select net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/sync-rankings',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);


-- ────────────────────────────────────────────────────────────
-- 4. APP SETTINGS
-- Store your Supabase URL and service role key as DB settings
-- so the cron jobs can call the Edge Functions.
-- Replace the placeholder values below with your real ones.
-- ────────────────────────────────────────────────────────────
alter database postgres set app.supabase_url          = 'https://YOUR_PROJECT_ID.supabase.co';
alter database postgres set app.service_role_key      = 'YOUR_SERVICE_ROLE_KEY';
-- After running this, reconnect to the DB for the settings to take effect.


-- ────────────────────────────────────────────────────────────
-- 5. USEFUL QUERIES FOR MANUAL CONTROL
-- ────────────────────────────────────────────────────────────

-- View all scheduled cron jobs:
-- select * from cron.job;

-- Delete a cron job:
-- select cron.unschedule('sync-tournament-matches');

-- Manually start a tournament (also auto-locks picks via trigger):
-- update public.tournaments set status = 'ongoing'
-- where name = 'Roland Garros 2025';

-- Manually run the scoring function:
-- select compute_tournament_scores(
--   (select id from tournaments where name = 'Roland Garros 2025')
-- );

-- Check cron job run history:
-- select * from cron.job_run_details order by start_time desc limit 20;

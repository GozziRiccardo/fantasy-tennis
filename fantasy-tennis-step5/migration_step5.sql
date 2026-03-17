-- ============================================================
-- FANTASY TENNIS — Step 5 SQL migration
-- Esegui nel Supabase SQL Editor
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- Nuovi cron job
-- (assicurati che pg_cron sia già abilitato dallo step 3)
-- ────────────────────────────────────────────────────────────

-- Job 3: Auto-start tornei + email reminder (ogni mattina alle 7:00 UTC)
select cron.schedule(
  'auto-start-tournaments',
  '0 7 * * *',
  $$
    select net.http_post(
      url     := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/auto-start-tournaments',
      headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- Job 4: Sync calendario tornei ogni lunedì alle 6:00 UTC
select cron.schedule(
  'sync-tournament-schedule',
  '0 6 * * 1',
  $$
    select net.http_post(
      url     := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/sync-schedule',
      headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- Verifica tutti i job attivi:
-- select jobname, schedule, command from cron.job order by jobid;

-- migrations/2026-07-03_reconcile-drifted-columns.sql
-- Reconciles two columns that exist in production (added directly via the
-- Supabase dashboard) but were never recorded in schema.sql or migrations/.
-- Idempotent: safe to run against production where both columns already exist
-- (ADD COLUMN IF NOT EXISTS no-ops; COMMENT ON just refreshes documentation).
--
-- Types match how the app actually uses them:
--   members.push_token   — APNs device token (hex string). Written by the
--                          Capacitor push-registration listener in src/App.js
--                          (last registering device wins); read by
--                          api/cron/reminders.js. NULL = no registered device.
--   habits.reminder_time — 'HH:MM' 24-hour Melbourne-local string, e.g.
--                          '09:00'. Written by the habit edit form; matched by
--                          EXACT string equality in the reminders cron's
--                          5-minute window (.in('reminder_time', [...])).
--                          NULL = no reminder. Deliberately text, not time:
--                          the app round-trips the exact 'HH:MM' string.

alter table members
  add column if not exists push_token text default null;

comment on column members.push_token is
  'APNs device token for push notifications (hex string). Written on push registration; last registering device wins. NULL = no registered device / push declined.';

alter table habits
  add column if not exists reminder_time text default null;

comment on column habits.reminder_time is
  'Daily reminder time as ''HH:MM'' (24h, Melbourne local), e.g. ''09:00''. Matched by exact string equality in api/cron/reminders.js. NULL = no reminder.';

-- Verification (run after applying — both rows should report data_type 'text'
-- and no default). If production created reminder_time as a TIME column, the
-- ADD COLUMN above no-ops and nothing breaks, but flag it so schema.sql can
-- be corrected:
--
--   select table_name, column_name, data_type, column_default
--   from information_schema.columns
--   where (table_name, column_name) in
--     (('members', 'push_token'), ('habits', 'reminder_time'));

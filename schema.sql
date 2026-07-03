-- ─── RITUAL APP — DATABASE SCHEMA ───────────────────────────────
-- Supabase / PostgreSQL
-- Run INITIAL SETUP on a fresh project.
-- Run MIGRATIONS block on an existing production database.

-- ═══════════════════════════════════════════════════════════════════
-- INITIAL SETUP (fresh project only)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists families (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  pin   text not null unique,
  created_at timestamp default now()
);

create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid references families(id) on delete cascade,
  name       text not null,
  avatar     text not null,
  color      text not null,
  is_kid     boolean default false,
  points     integer default 0,
  streak     integer default 0,
  -- APNs device token (hex string); last registering device wins. NULL = none.
  push_token text default null,
  created_at timestamp default now()
);

create table if not exists habits (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid references families(id) on delete cascade,
  name         text not null,
  icon         text not null,
  category     text not null,
  category_id  text not null,
  color        text not null,
  location     text,
  target       integer default 1,
  streak       integer default 0,
  is_kid       boolean default false,
  is_custom    boolean default false,
  tile_uid     text,
  -- is_shared: true = ask "Who did this?"; false = auto-assign to current member
  is_shared    boolean default true,
  -- points: per-habit point value (reserved for future use, default 10)
  points       integer default 10,
  -- 'HH:MM' 24h Melbourne-local reminder time (exact-string matched by
  -- api/cron/reminders.js). NULL = no reminder.
  reminder_time text default null,
  created_at   timestamp default now()
);

-- One row per (habit, member, date). taps increments on each scan.
create table if not exists completions (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid references habits(id) on delete cascade,
  member_id  uuid references members(id) on delete cascade,
  family_id  uuid references families(id) on delete cascade,
  date       date not null,
  taps       integer default 0,
  completed_at timestamp default now(),
  unique (habit_id, member_id, date)
);

create table if not exists rewards (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid references families(id) on delete cascade,
  name       text not null,
  points     integer not null,
  icon       text not null,
  who        text not null,
  color      text not null,
  created_at timestamp default now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────
-- tile_uid: looked up on every NFC tap
create index if not exists idx_habits_tile_uid
  on habits(tile_uid) where tile_uid is not null;
-- completion queries by family+date (today/week)
create index if not exists idx_completions_family_date
  on completions(family_id, date);
-- streak logic: yesterday's completions by habit
create index if not exists idx_completions_habit_date
  on completions(habit_id, date);
-- streak logic: yesterday's completions by member
create index if not exists idx_completions_member_date
  on completions(member_id, date);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────
alter table families    enable row level security;
alter table members     enable row level security;
alter table habits      enable row level security;
alter table completions enable row level security;
alter table rewards     enable row level security;

-- Permissive (PIN-gated at app level, not DB level)
create policy "allow all" on families    for all using (true) with check (true);
create policy "allow all" on members     for all using (true) with check (true);
create policy "allow all" on habits      for all using (true) with check (true);
create policy "allow all" on completions for all using (true) with check (true);
create policy "allow all" on rewards     for all using (true) with check (true);


-- ═══════════════════════════════════════════════════════════════════
-- MIGRATIONS — run this on existing production DB
-- (safe to run multiple times)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add tile_uid column (replaces old tile_configured boolean)
alter table habits add column if not exists tile_uid text;

-- 2. Add is_shared column (default true = backwards compatible with all existing habits)
alter table habits add column if not exists is_shared boolean default true;

-- 3. Add per-habit points column (reserved, not yet used in UI)
alter table habits add column if not exists points integer default 10;

-- 4. Backfill: ensure no NULLs in is_shared
update habits set is_shared = true where is_shared is null;

-- 5. Indexes
create index if not exists idx_habits_tile_uid
  on habits(tile_uid) where tile_uid is not null;
create index if not exists idx_completions_family_date
  on completions(family_id, date);
create index if not exists idx_completions_habit_date
  on completions(habit_id, date);
create index if not exists idx_completions_member_date
  on completions(member_id, date);

-- 6. Comments
comment on column habits.tile_uid is
  'NFC UID: normalized (colons stripped, uppercase). e.g. "04969E5AC22A81"';
comment on column habits.is_shared is
  'true = show "Who did this?" on tile tap (shared). false = auto-assign to current member (personal).';

-- 7. Add assigned_member_ids column (uuid array — NULL=everyone, [id]=one person, [id1,id2]=multiple)
--    NOTE: Production uses this plural uuid[] array. The old singular assigned_member_id design was not used.
alter table habits add column if not exists assigned_member_ids uuid[];

-- 8. Add days_active column (day-of-week filter: 0=Mon … 6=Sun)
alter table habits add column if not exists days_active integer[];

-- 9. Backfill defaults
update habits set assigned_member_ids = null where assigned_member_ids is null;
update habits set days_active = null where days_active is null;

-- 10. GIN index for assigned_member_ids array lookups
create index if not exists idx_habits_assigned_members
  on habits using gin(assigned_member_ids) where assigned_member_ids is not null;

-- 11. Comments
comment on column habits.assigned_member_ids is
  'Array of member UUIDs. NULL = visible to everyone. [id] = one person. [id1,id2] = multiple people.';
comment on column habits.days_active is
  'Days of week habit is active (0=Monday to 6=Sunday). NULL or empty = active daily. Example: [0,1,2,3,4] = weekdays only.';

-- 12. Add completion_type column (Wave 2 — March 17 2026)
alter table habits add column if not exists completion_type text default 'individual';
alter table habits add constraint if not exists habits_completion_type_check
  check (completion_type in ('individual', 'shared'));
update habits set completion_type = 'individual' where completion_type is null;
create index if not exists idx_habits_completion_type on habits(completion_type);
comment on column habits.completion_type is
  'individual = each person tracked separately. shared = one completion syncs to all assigned members.';

-- 13. Analytics index for time-of-day queries (Wave 3 — Insights tab)
create index if not exists idx_completions_completed_at
  on completions(completed_at);
comment on index idx_completions_completed_at is
  'Used by Insights tab for time-of-day behavior analytics';


-- 14. Reward columns + redemptions tracking (Wave 4 — Points & Rewards)
alter table rewards add column if not exists assigned_to uuid[];
alter table rewards add column if not exists status text default 'active';
create index if not exists idx_rewards_status on rewards(status) where status = 'active';
comment on column rewards.assigned_to is
  'Array of member UUIDs who can see/redeem this reward. NULL = everyone.';
comment on column rewards.status is
  'active = available for redemption. archived = no longer offered.';

create table if not exists reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid references rewards(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  family_id uuid references families(id) on delete cascade,
  points_spent integer not null,
  redeemed_at timestamp default now(),
  status text default 'pending',
  fulfilled_at timestamp,
  notes text,
  created_at timestamp default now()
);
create index if not exists idx_redemptions_member on reward_redemptions(member_id);
create index if not exists idx_redemptions_status on reward_redemptions(status);
create index if not exists idx_redemptions_family on reward_redemptions(family_id, status);
comment on table reward_redemptions is
  'Tracks reward redemptions. Status: pending (awaiting parent fulfillment), fulfilled (delivered), cancelled (refunded).';


-- 15. Onboarding status per member (March 2026)
--     Replaces localStorage-based approach so onboarding only shows once across all devices
alter table members add column if not exists onboarding_complete boolean default false;
update members set onboarding_complete = false where onboarding_complete is null;
comment on column members.onboarding_complete is
  'True after member has completed or skipped onboarding. Checked on login; avoids re-showing onboarding on new devices.';


-- 16. create_family RPC — SECURITY DEFINER family creation (March 2026)
--     Direct anon INSERT on the families table is blocked when RLS policies are
--     restrictive. This function runs as the table owner and bypasses that check,
--     while also returning the new row so the caller doesn't need a second
--     login_family RPC round-trip.
--
--     DESIGN NOTE: PIN is NOT unique across families (see migration 19).
--     "Bekker 1234" and "Jones 1234" are different families and both valid.
--     Duplicate detection uses name+pin together (handled by login_family check before calling this).
create or replace function create_family(family_name text, family_pin text)
returns table (id uuid, name text, pin text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    insert into families (name, pin)
    values (family_name, family_pin)
    returning families.id, families.name, families.pin;
end;
$$;

comment on function create_family(text, text) is
  'Creates a new family row and returns it. PIN is not unique across families — callers should check for duplicate name+pin via login_family before calling this. SECURITY DEFINER so it works regardless of RLS insert policies on the families table.';


-- 17. is_solo column — distinguish solo accounts from family accounts (March 2026)
--     Solo accounts are created via the "Just me" onboarding flow.
--     Previously indistinguishable at DB level (solo mode was localStorage-only).
alter table families add column if not exists is_solo boolean default false;
update families set is_solo = false where is_solo is null;
comment on column families.is_solo is
  'True for accounts created via the "Just me" solo flow. False for family accounts. Set at creation time.';


-- 18. login_family RPC — name+pin family lookup (March 2026)
--     BUG FIX: Previous version matched on PIN alone (WHERE pin = family_pin).
--     Since PIN is no longer unique, this must match on BOTH name AND pin.
--     Uses LOWER() for case-insensitive name matching so "Bekker" == "bekker".
create or replace function login_family(family_name text, family_pin text)
returns table (id uuid, name text, pin text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select f.id, f.name, f.pin
    from families f
    where lower(f.name) = lower(family_name)
    and f.pin = family_pin;
end;
$$;

comment on function login_family(text, text) is
  'Looks up a family by name (case-insensitive) and PIN. Returns the matching row, or zero rows if name+pin do not match any family.';


-- 19. Drop unique PIN constraint — PIN is a convenience code, not a unique identifier (March 2026)
--     Multiple families can share the same PIN. Login uses name+pin together.
--     Keep a regular (non-unique) index for lookup performance.
--
--     IMPORTANT: Run this block AFTER running migrations 16–18 above.
--     First find the constraint name (it may vary):
--       SELECT constraint_name FROM information_schema.table_constraints
--       WHERE table_name = 'families' AND constraint_type = 'UNIQUE';
--     Then drop it. Most likely name is 'families_pin_key':
alter table families drop constraint if exists families_pin_key;
-- If the constraint has a different name, run the SELECT above and adjust:
-- alter table families drop constraint <constraint_name>;
--
-- Add a regular (non-unique) index for PIN lookups:
create index if not exists idx_families_pin on families(pin);


-- 20. Backfill marker on completions (May 2026)
--     "Mark as done yesterday" feature writes completion rows with
--     backfilled_at = now(). Live taps leave it null. Used to
--     distinguish backfilled rows from organic completions for
--     analytics, audit, and any future "undo backfill" surface.
alter table completions
  add column if not exists backfilled_at timestamptz default null;

create index if not exists idx_completions_backfilled
  on completions(backfilled_at) where backfilled_at is not null;

comment on column completions.backfilled_at is
  'When set, this completion was created via the backfill feature, not a live tap. Null for live taps.';


-- 21. Account holder column + family creation under Supabase Auth (May 2026)
--     Phase 1 of the email/password auth migration. Adds a nullable
--     account_holder_id pointing at auth.users so a family can be claimed
--     by exactly one Supabase auth user (Netflix-style — one paying account
--     per household, with members as in-app profiles).
--
--     Nullable for now so the column can be backfilled for existing PIN-only
--     families without breaking writes. Phase 3 will SET NOT NULL after
--     every row is populated and PIN code paths are removed from the app.
alter table families
  add column if not exists account_holder_id uuid references auth.users(id) on delete restrict;

comment on column families.account_holder_id is
  'Supabase auth user who owns this family (single auth user per family, Netflix-style). Nullable until backfill complete; will become non-null after Phase 3 cleanup.';

create index if not exists idx_families_account_holder
  on families(account_holder_id) where account_holder_id is not null;

create or replace function create_family_with_account_holder(p_family_name text)
returns table (id uuid, name text, account_holder_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    insert into families (name, account_holder_id)
    values (p_family_name, auth.uid())
    returning families.id, families.name, families.account_holder_id;
end;
$$;

revoke all on function create_family_with_account_holder(text) from public;
grant execute on function create_family_with_account_holder(text) to authenticated;

comment on function create_family_with_account_holder(text) is
  'Creates a new family owned by the calling auth user. SECURITY DEFINER so it works regardless of RLS insert policies. Authenticated callers only — anon cannot invoke.';


-- ============================================================================
-- 22. STAGED RLS POLICIES FOR PHASE 3 ACTIVATION (May 2026)
-- ============================================================================
-- DO NOT UNCOMMENT IN PHASE 1. These policies replace the current "allow all"
-- policies and gate every family-scoped read/write on auth.uid() = the
-- family's account_holder_id. Activating these before backfill
-- (account_holder_id is populated for every existing family) will lock all
-- current users out.
--
-- Phase 3 sequence:
--   1. Confirm every families row has account_holder_id IS NOT NULL
--   2. Drop existing "allow all" policies on each table
--   3. Uncomment and apply the policies below
--   4. alter table families alter column account_holder_id set not null
--   5. Remove PIN-based code paths from App.js
-- ============================================================================

-- families: only the account holder can read/write their family
-- drop policy if exists "allow all" on families;
-- create policy "account_holder_full" on families for all
--   using (auth.uid() = account_holder_id)
--   with check (auth.uid() = account_holder_id);

-- members: scoped via family
-- drop policy if exists "allow all" on members;
-- create policy "account_holder_full" on members for all
--   using (family_id in (select id from families where account_holder_id = auth.uid()))
--   with check (family_id in (select id from families where account_holder_id = auth.uid()));

-- habits: scoped via family
-- drop policy if exists "allow all" on habits;
-- create policy "account_holder_full" on habits for all
--   using (family_id in (select id from families where account_holder_id = auth.uid()))
--   with check (family_id in (select id from families where account_holder_id = auth.uid()));

-- completions: scoped via family
-- drop policy if exists "allow all" on completions;
-- create policy "account_holder_full" on completions for all
--   using (family_id in (select id from families where account_holder_id = auth.uid()))
--   with check (family_id in (select id from families where account_holder_id = auth.uid()));

-- rewards: scoped via family
-- drop policy if exists "allow all" on rewards;
-- create policy "account_holder_full" on rewards for all
--   using (family_id in (select id from families where account_holder_id = auth.uid()))
--   with check (family_id in (select id from families where account_holder_id = auth.uid()));

-- reward_redemptions: TBD — current RLS state unknown per Phase 0 audit.
--                     Finalise in Phase 3 once dashboard inspection confirms
--                     whether RLS is enabled and what (if any) policy exists.


-- 23. Reconcile drifted columns (July 2026)
--     members.push_token and habits.reminder_time were added directly in the
--     Supabase dashboard and never recorded here. This block documents them
--     and makes fresh setups match production. Idempotent.
--     (Also shipped as migrations/2026-07-03_reconcile-drifted-columns.sql.)
alter table members
  add column if not exists push_token text default null;
comment on column members.push_token is
  'APNs device token for push notifications (hex string). Written on push registration; last registering device wins. NULL = no registered device / push declined.';

alter table habits
  add column if not exists reminder_time text default null;
comment on column habits.reminder_time is
  'Daily reminder time as ''HH:MM'' (24h, Melbourne local), e.g. ''09:00''. Matched by exact string equality in api/cron/reminders.js. NULL = no reminder.';


-- ═══════════════════════════════════════════════════════════════════
-- NOTES
-- ═══════════════════════════════════════════════════════════════════
-- NFC tile URL formats supported by app:
--   Path-based (production): https://ritual.app/t/04:96:9E:5A:C2:2A:81
--   Query param (legacy):    https://ritual-v2-mu.vercel.app?tile=04:96:9E:5A:C2:2A:81
-- App normalizes UID on read: raw.replace(/:/g, "").toUpperCase()

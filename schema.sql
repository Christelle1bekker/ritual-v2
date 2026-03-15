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


-- ═══════════════════════════════════════════════════════════════════
-- NOTES
-- ═══════════════════════════════════════════════════════════════════
-- NFC tile URL formats supported by app:
--   Path-based (production): https://ritual.app/t/04:96:9E:5A:C2:2A:81
--   Query param (legacy):    https://ritual-v2-mu.vercel.app?tile=04:96:9E:5A:C2:2A:81
-- App normalizes UID on read: raw.replace(/:/g, "").toUpperCase()

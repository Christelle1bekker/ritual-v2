-- Ritual App Database Schema
-- Run this in Supabase SQL Editor

-- Families table
create table if not exists families (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  pin text not null unique,
  created_at timestamp default now()
);

-- Members table
create table if not exists members (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid references families(id) on delete cascade,
  name text not null,
  avatar text not null,
  color text not null,
  is_kid boolean default false,
  points integer default 0,
  streak integer default 0,
  created_at timestamp default now()
);

-- Habits table
create table if not exists habits (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid references families(id) on delete cascade,
  name text not null,
  icon text not null,
  category text not null,
  category_id text not null,
  color text not null,
  location text,
  target integer default 1,
  streak integer default 0,
  is_kid boolean default false,
  is_custom boolean default false,
  tile_configured boolean default false,
  created_at timestamp default now()
);

-- Completions table (source of truth for daily taps)
create table if not exists completions (
  id uuid primary key default uuid_generate_v4(),
  habit_id uuid references habits(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  family_id uuid references families(id) on delete cascade,
  date date not null,
  taps integer default 0,
  completed_at timestamp default now(),
  unique(habit_id, member_id, date)
);

-- Rewards table
create table if not exists rewards (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid references families(id) on delete cascade,
  name text not null,
  points integer not null,
  icon text not null,
  who text not null,
  color text not null,
  created_at timestamp default now()
);

-- Enable Row Level Security
alter table families enable row level security;
alter table members enable row level security;
alter table habits enable row level security;
alter table completions enable row level security;
alter table rewards enable row level security;

-- Create policies (allow all access - PIN-based auth)
create policy "Allow all operations on families" on families for all using (true);
create policy "Allow all operations on members" on members for all using (true);
create policy "Allow all operations on habits" on habits for all using (true);
create policy "Allow all operations on completions" on completions for all using (true);
create policy "Allow all operations on rewards" on rewards for all using (true);

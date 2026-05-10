-- Maurice v2 — health tracking table
-- Paste into Supabase SQL Editor and Run.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS maurice_health (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  last_bundle_version TEXT,
  last_telegram_chat_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the single row that Maurice upserts into.
INSERT INTO maurice_health (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS: enabled, but service role (used by Maurice) bypasses it anyway.
-- Policy exists so the table is explicit about its access model.
ALTER TABLE maurice_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON maurice_health;
CREATE POLICY "Service role full access" ON maurice_health
  FOR ALL USING (true) WITH CHECK (true);

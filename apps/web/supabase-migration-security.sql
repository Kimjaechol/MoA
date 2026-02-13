-- ============================================
-- MoA Security & Cross-Channel — Schema Migration
-- Run this in Supabase SQL Editor AFTER the base schema
-- ============================================

-- 1. Fix moa_channel_connections unique constraint
--    Old: UNIQUE(user_id, channel)     — one channel per user
--    New: UNIQUE(channel, channel_user_id) — one MoA user per channel identity
-- This allows multiple channels to map to the same MoA user.

-- Drop old constraint (safe — IF EXISTS)
ALTER TABLE moa_channel_connections
  DROP CONSTRAINT IF EXISTS moa_channel_connections_user_id_channel_key;

-- Add new constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'moa_channel_connections_channel_channel_user_id_key'
  ) THEN
    ALTER TABLE moa_channel_connections
      ADD CONSTRAINT moa_channel_connections_channel_channel_user_id_key
      UNIQUE(channel, channel_user_id);
  END IF;
END $$;

-- Add linked_at column
ALTER TABLE moa_channel_connections
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

-- Optimized lookup index: find MoA user by channel identity
CREATE INDEX IF NOT EXISTS idx_channel_conn_lookup
  ON moa_channel_connections(channel, channel_user_id) WHERE is_active = true;

-- 2. Add preferred_provider/model to moa_user_settings
ALTER TABLE moa_user_settings
  ADD COLUMN IF NOT EXISTS preferred_provider TEXT,
  ADD COLUMN IF NOT EXISTS preferred_model TEXT;

-- 3. Security audit log table
CREATE TABLE IF NOT EXISTS moa_security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  channel TEXT,
  user_id_hash TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_security_audit_log ENABLE ROW LEVEL SECURITY;

-- No anon access
CREATE POLICY "Service only" ON moa_security_audit_log
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_security_audit_type ON moa_security_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_severity ON moa_security_audit_log(severity)
  WHERE severity IN ('warning', 'critical');
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON moa_security_audit_log(created_at DESC);

-- 4. Backfill: ensure channel_user_id is NOT NULL for existing rows
UPDATE moa_channel_connections
  SET channel_user_id = REPLACE(user_id, channel || '_', '')
  WHERE channel_user_id IS NULL;

-- ============================================
-- MoA Alimtalk (알림톡) — Schema Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add phone column to moa_user_settings
ALTER TABLE moa_user_settings
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kakao_channel_added BOOLEAN NOT NULL DEFAULT false;

-- Index for phone-based lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_phone
  ON moa_user_settings(phone) WHERE phone IS NOT NULL;

-- 2. Alimtalk send log (알림톡 발송 기록)
CREATE TABLE IF NOT EXISTS moa_alimtalk_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  template_code TEXT NOT NULL,
  template_params JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  request_id TEXT,         -- NHN Cloud Toast request ID
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_alimtalk_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service only" ON moa_alimtalk_log
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_alimtalk_log_user ON moa_alimtalk_log(user_id);
CREATE INDEX IF NOT EXISTS idx_alimtalk_log_phone ON moa_alimtalk_log(phone);
CREATE INDEX IF NOT EXISTS idx_alimtalk_log_created ON moa_alimtalk_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alimtalk_log_template ON moa_alimtalk_log(template_code);

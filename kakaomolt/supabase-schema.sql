-- LawCall Billing System - Supabase Schema
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS lawcall_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kakao_user_id TEXT UNIQUE NOT NULL,
  credits INTEGER NOT NULL DEFAULT 1000,
  total_spent INTEGER NOT NULL DEFAULT 0,
  custom_api_key TEXT, -- Encrypted API key
  custom_provider TEXT CHECK (custom_provider IN ('anthropic', 'openai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by kakao_user_id
CREATE INDEX IF NOT EXISTS idx_lawcall_users_kakao_id ON lawcall_users(kakao_user_id);

-- ============================================
-- Usage History Table
-- ============================================
CREATE TABLE IF NOT EXISTS lawcall_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  credits_used INTEGER NOT NULL,
  used_platform_key BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user usage lookup
CREATE INDEX IF NOT EXISTS idx_lawcall_usage_user_id ON lawcall_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_lawcall_usage_created_at ON lawcall_usage(created_at DESC);

-- ============================================
-- Payments Table
-- ============================================
CREATE TABLE IF NOT EXISTS lawcall_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
  payment_key TEXT,
  toss_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for order lookup
CREATE INDEX IF NOT EXISTS idx_lawcall_payments_order_id ON lawcall_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_lawcall_payments_user_id ON lawcall_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_lawcall_payments_status ON lawcall_payments(status);

-- ============================================
-- Updated At Trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_lawcall_users_updated_at
  BEFORE UPDATE ON lawcall_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE lawcall_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lawcall_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE lawcall_payments ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access on lawcall_users"
  ON lawcall_users FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on lawcall_usage"
  ON lawcall_usage FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on lawcall_payments"
  ON lawcall_payments FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- Useful Views
-- ============================================

-- User statistics view
CREATE OR REPLACE VIEW lawcall_user_stats AS
SELECT
  u.id,
  u.kakao_user_id,
  u.credits,
  u.total_spent,
  u.custom_api_key IS NOT NULL as has_custom_key,
  u.custom_provider,
  u.created_at,
  COUNT(DISTINCT us.id) as total_requests,
  COALESCE(SUM(us.credits_used), 0) as credits_used_30d
FROM lawcall_users u
LEFT JOIN lawcall_usage us ON us.user_id = u.id AND us.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.id, u.kakao_user_id, u.credits, u.total_spent, u.custom_api_key, u.custom_provider, u.created_at;

-- Daily revenue view
CREATE OR REPLACE VIEW lawcall_daily_revenue AS
SELECT
  DATE(created_at) as date,
  COUNT(*) as payment_count,
  SUM(amount) as total_revenue,
  SUM(credits) as total_credits_sold
FROM lawcall_payments
WHERE status = 'completed'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- ============================================
-- Functions for Atomic Operations
-- ============================================

-- Atomic credit deduction
CREATE OR REPLACE FUNCTION deduct_credits(
  p_kakao_user_id TEXT,
  p_amount INTEGER
) RETURNS TABLE(success BOOLEAN, new_balance INTEGER, error_message TEXT) AS $$
DECLARE
  v_user_id UUID;
  v_current_credits INTEGER;
BEGIN
  -- Get user and lock row
  SELECT id, credits INTO v_user_id, v_current_credits
  FROM lawcall_users
  WHERE kakao_user_id = p_kakao_user_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 'User not found'::TEXT;
    RETURN;
  END IF;

  IF v_current_credits < p_amount THEN
    RETURN QUERY SELECT false, v_current_credits, 'Insufficient credits'::TEXT;
    RETURN;
  END IF;

  -- Deduct credits
  UPDATE lawcall_users
  SET credits = credits - p_amount,
      total_spent = total_spent + p_amount
  WHERE id = v_user_id;

  RETURN QUERY SELECT true, v_current_credits - p_amount, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Atomic credit addition (for refunds or payments)
CREATE OR REPLACE FUNCTION add_credits(
  p_kakao_user_id TEXT,
  p_amount INTEGER
) RETURNS TABLE(success BOOLEAN, new_balance INTEGER) AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  UPDATE lawcall_users
  SET credits = credits + p_amount
  WHERE kakao_user_id = p_kakao_user_id
  RETURNING credits INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    -- User doesn't exist, create new user with credits
    INSERT INTO lawcall_users (kakao_user_id, credits)
    VALUES (p_kakao_user_id, p_amount)
    RETURNING credits INTO v_new_balance;
  END IF;

  RETURN QUERY SELECT true, v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- Complete payment and add credits atomically
CREATE OR REPLACE FUNCTION complete_payment(
  p_order_id TEXT,
  p_payment_key TEXT,
  p_toss_response JSONB DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, credits_added INTEGER, new_balance INTEGER, error_message TEXT) AS $$
DECLARE
  v_payment RECORD;
  v_new_balance INTEGER;
BEGIN
  -- Get payment and lock
  SELECT p.*, u.kakao_user_id
  INTO v_payment
  FROM lawcall_payments p
  JOIN lawcall_users u ON u.id = p.user_id
  WHERE p.order_id = p_order_id
  FOR UPDATE;

  IF v_payment IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 'Payment not found'::TEXT;
    RETURN;
  END IF;

  IF v_payment.status != 'pending' THEN
    RETURN QUERY SELECT false, 0, 0, ('Payment already ' || v_payment.status)::TEXT;
    RETURN;
  END IF;

  -- Update payment status
  UPDATE lawcall_payments
  SET status = 'completed',
      payment_key = p_payment_key,
      toss_response = p_toss_response,
      completed_at = NOW()
  WHERE order_id = p_order_id;

  -- Add credits to user
  UPDATE lawcall_users
  SET credits = credits + v_payment.credits
  WHERE id = v_payment.user_id
  RETURNING credits INTO v_new_balance;

  RETURN QUERY SELECT true, v_payment.credits, v_new_balance, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- E2E Memory Sync System
-- ============================================

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Device registry for multi-device sync
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT CHECK (device_type IN ('mobile', 'desktop', 'tablet', 'unknown')),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);

-- Encrypted memory storage (E2E - server cannot read)
CREATE TABLE IF NOT EXISTS memory_sync (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,

  -- E2E encrypted data (server cannot decrypt)
  encrypted_data TEXT NOT NULL,           -- Base64 encoded AES-256-GCM ciphertext
  iv TEXT NOT NULL,                       -- Initialization vector
  auth_tag TEXT NOT NULL,                 -- GCM authentication tag

  -- Metadata (not encrypted, for sync logic)
  version INTEGER NOT NULL DEFAULT 1,     -- Incremental version for conflict resolution
  chunk_index INTEGER NOT NULL DEFAULT 0, -- For large data split into chunks
  total_chunks INTEGER NOT NULL DEFAULT 1,
  data_type TEXT NOT NULL CHECK (data_type IN ('memory', 'context', 'settings', 'full_backup')),
  checksum TEXT NOT NULL,                 -- SHA-256 of plaintext for integrity

  -- Sync metadata
  source_device_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                 -- Optional auto-expiry

  UNIQUE(user_id, data_type, version, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_memory_sync_user_id ON memory_sync(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_sync_expires ON memory_sync(expires_at) WHERE expires_at IS NOT NULL;

-- Sync delta changes (for incremental sync)
CREATE TABLE IF NOT EXISTS memory_deltas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,

  -- E2E encrypted delta
  encrypted_delta TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,

  -- Delta metadata
  base_version INTEGER NOT NULL,          -- Version this delta applies to
  delta_type TEXT NOT NULL CHECK (delta_type IN ('add', 'update', 'delete')),
  entity_type TEXT NOT NULL,              -- 'memory_chunk', 'conversation', 'setting'

  source_device_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ                  -- When delta was applied to full sync
);

CREATE INDEX IF NOT EXISTS idx_memory_deltas_user_version ON memory_deltas(user_id, base_version);

-- Conversation history (E2E encrypted)
CREATE TABLE IF NOT EXISTS conversation_sync (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,

  -- E2E encrypted messages
  encrypted_messages TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,

  -- Metadata
  message_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,

  source_device_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ephemeral mode: auto-expire after TTL (NULL = persistent/no expiry)
  expires_at TIMESTAMPTZ DEFAULT NULL,

  UNIQUE(user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_sync_user_id ON conversation_sync(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_sync_expires ON conversation_sync(expires_at) WHERE expires_at IS NOT NULL;

-- Key derivation salts (per user, for PBKDF2)
CREATE TABLE IF NOT EXISTS user_key_salts (
  user_id UUID PRIMARY KEY REFERENCES lawcall_users(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,                     -- Base64 encoded salt
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Sync Functions
-- ============================================

-- Get latest sync version for a user
CREATE OR REPLACE FUNCTION get_sync_version(p_user_id UUID, p_data_type TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) INTO v_version
  FROM memory_sync
  WHERE user_id = p_user_id AND data_type = p_data_type;
  RETURN v_version;
END;
$$ LANGUAGE plpgsql;

-- Clean up expired sync data (memory_sync + conversation_sync)
CREATE OR REPLACE FUNCTION cleanup_expired_sync()
RETURNS INTEGER AS $$
DECLARE
  mem_deleted INTEGER;
  conv_deleted INTEGER;
BEGIN
  DELETE FROM memory_sync WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS mem_deleted = ROW_COUNT;

  DELETE FROM conversation_sync WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS conv_deleted = ROW_COUNT;

  RETURN mem_deleted + conv_deleted;
END;
$$ LANGUAGE plpgsql;

-- Atomic sync upload with version check
CREATE OR REPLACE FUNCTION upload_sync_data(
  p_user_id UUID,
  p_encrypted_data TEXT,
  p_iv TEXT,
  p_auth_tag TEXT,
  p_data_type TEXT,
  p_checksum TEXT,
  p_source_device_id TEXT,
  p_chunk_index INTEGER DEFAULT 0,
  p_total_chunks INTEGER DEFAULT 1,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, new_version INTEGER, error_message TEXT) AS $$
DECLARE
  v_new_version INTEGER;
BEGIN
  -- Get next version
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version
  FROM memory_sync
  WHERE user_id = p_user_id AND data_type = p_data_type;

  -- Insert new sync data
  INSERT INTO memory_sync (
    user_id, encrypted_data, iv, auth_tag,
    version, chunk_index, total_chunks, data_type, checksum,
    source_device_id, expires_at
  ) VALUES (
    p_user_id, p_encrypted_data, p_iv, p_auth_tag,
    v_new_version, p_chunk_index, p_total_chunks, p_data_type, p_checksum,
    p_source_device_id, p_expires_at
  );

  -- Update device last sync time
  UPDATE user_devices
  SET last_sync_at = NOW()
  WHERE user_id = p_user_id AND device_id = p_source_device_id;

  RETURN QUERY SELECT true, v_new_version, NULL::TEXT;
EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY SELECT false, 0, 'Version conflict - retry with latest version'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Get sync data for download
CREATE OR REPLACE FUNCTION download_sync_data(
  p_user_id UUID,
  p_data_type TEXT,
  p_min_version INTEGER DEFAULT 0
) RETURNS TABLE(
  encrypted_data TEXT,
  iv TEXT,
  auth_tag TEXT,
  version INTEGER,
  chunk_index INTEGER,
  total_chunks INTEGER,
  checksum TEXT,
  source_device_id TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ms.encrypted_data,
    ms.iv,
    ms.auth_tag,
    ms.version,
    ms.chunk_index,
    ms.total_chunks,
    ms.checksum,
    ms.source_device_id,
    ms.created_at
  FROM memory_sync ms
  WHERE ms.user_id = p_user_id
    AND ms.data_type = p_data_type
    AND ms.version > p_min_version
    AND (ms.expires_at IS NULL OR ms.expires_at > NOW())
  ORDER BY ms.version DESC, ms.chunk_index ASC
  LIMIT 100; -- Safety limit
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS for new tables
-- ============================================
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_deltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_key_salts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_devices"
  ON user_devices FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on memory_sync"
  ON memory_sync FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on memory_deltas"
  ON memory_deltas FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on conversation_sync"
  ON conversation_sync FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on user_key_salts"
  ON user_key_salts FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Scheduled cleanup for ephemeral sync data
-- ============================================
-- Enable pg_cron if available:
-- SELECT cron.schedule('cleanup-expired-sync', '*/5 * * * *', 'SELECT cleanup_expired_sync()');
--
-- Ephemeral mode (syncMode="ephemeral"):
-- uploads set expires_at = now + 5min; cleanup runs every 5 minutes.
-- This ensures server retains ZERO user data after TTL.
--
-- Persistent mode (syncMode="persistent"):
-- uploads set expires_at = NULL; cleanup has no effect on these rows.

-- ============================================
-- Enable Realtime for device-to-device push
-- ============================================
-- Supabase Realtime listens for INSERT on memory_sync and memory_deltas.
-- Ephemeral mode relies on this for instant delivery before TTL expires.
ALTER PUBLICATION supabase_realtime ADD TABLE memory_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE memory_deltas;

-- ============================================
-- Sample Data (Optional - for testing)
-- ============================================
-- INSERT INTO lawcall_users (kakao_user_id, credits) VALUES ('test_user_001', 10000);

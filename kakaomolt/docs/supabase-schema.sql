-- ============================================
-- KakaoMolt Supabase Schema
-- Multi-Provider LLM Support
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- User Settings Table (Multi-Provider API Keys)
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kakao_user_id TEXT UNIQUE NOT NULL,

  -- Model preferences
  preferred_provider TEXT DEFAULT 'anthropic',
  preferred_model TEXT DEFAULT 'claude-3-5-haiku-20241022',

  -- Encrypted API keys for each provider (JSONB)
  -- Keys: anthropic, openai, google, groq, together, openrouter
  api_keys JSONB DEFAULT '{}',

  -- Auto-fallback to free tier when credits run out
  auto_fallback BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_user_settings_kakao_id ON user_settings(kakao_user_id);

-- ============================================
-- User Credits Table (Legacy Compatibility)
-- ============================================

CREATE TABLE IF NOT EXISTS lawcall_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kakao_user_id TEXT UNIQUE NOT NULL,
  credits BIGINT DEFAULT 1000,
  total_spent BIGINT DEFAULT 0,

  -- Legacy API key fields (for backward compatibility)
  custom_api_key TEXT,
  custom_provider TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lawcall_users_kakao_id ON lawcall_users(kakao_user_id);

-- ============================================
-- Usage Tracking Table
-- ============================================

CREATE TABLE IF NOT EXISTS lawcall_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES lawcall_users(id),

  -- Model info
  model TEXT NOT NULL,
  provider TEXT,

  -- Token usage
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,

  -- Cost
  credits_used INTEGER DEFAULT 0,
  used_platform_key BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lawcall_usage_user_id ON lawcall_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_lawcall_usage_created_at ON lawcall_usage(created_at);

-- ============================================
-- Payment Records Table
-- ============================================

CREATE TABLE IF NOT EXISTS lawcall_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES lawcall_users(id),

  -- Package info
  package_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  credits INTEGER NOT NULL,

  -- Payment status
  status TEXT DEFAULT 'pending', -- pending, completed, failed, cancelled, refunded
  payment_key TEXT,

  -- Toss response (for debugging)
  toss_response JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lawcall_payments_order_id ON lawcall_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_lawcall_payments_user_id ON lawcall_payments(user_id);

-- ============================================
-- Sync Tables (E2E Encrypted Memory Sync)
-- ============================================

CREATE TABLE IF NOT EXISTS user_key_salts (
  user_id UUID PRIMARY KEY,
  salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_devices (
  user_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT,
  last_sync_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS memory_sync (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  data_type TEXT NOT NULL, -- 'memory', 'sessions', 'settings'
  encrypted_data TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  checksum TEXT,
  chunk_index INTEGER DEFAULT 0,
  total_chunks INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,
  source_device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_sync_user_id ON memory_sync(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_sync_data_type ON memory_sync(data_type);

-- ============================================
-- RPC Functions
-- ============================================

-- Set API key for a provider (atomic)
CREATE OR REPLACE FUNCTION set_user_api_key(
  p_kakao_user_id TEXT,
  p_provider TEXT,
  p_encrypted_key TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE user_settings
  SET
    api_keys = jsonb_set(COALESCE(api_keys, '{}'), ARRAY[p_provider], to_jsonb(p_encrypted_key)),
    updated_at = now()
  WHERE kakao_user_id = p_kakao_user_id;

  -- If no row was updated, insert a new one
  IF NOT FOUND THEN
    INSERT INTO user_settings (kakao_user_id, api_keys)
    VALUES (p_kakao_user_id, jsonb_build_object(p_provider, p_encrypted_key));
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Remove API key for a provider
CREATE OR REPLACE FUNCTION remove_user_api_key(
  p_kakao_user_id TEXT,
  p_provider TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE user_settings
  SET
    api_keys = api_keys - p_provider,
    updated_at = now()
  WHERE kakao_user_id = p_kakao_user_id;
END;
$$ LANGUAGE plpgsql;

-- Deduct credits (atomic)
CREATE OR REPLACE FUNCTION deduct_credits(
  p_kakao_user_id TEXT,
  p_amount INTEGER
) RETURNS TABLE(new_balance BIGINT) AS $$
BEGIN
  UPDATE lawcall_users
  SET
    credits = GREATEST(0, credits - p_amount),
    total_spent = total_spent + p_amount,
    updated_at = now()
  WHERE kakao_user_id = p_kakao_user_id;

  RETURN QUERY
  SELECT credits FROM lawcall_users WHERE kakao_user_id = p_kakao_user_id;
END;
$$ LANGUAGE plpgsql;

-- Add credits (atomic)
CREATE OR REPLACE FUNCTION add_credits(
  p_kakao_user_id TEXT,
  p_amount INTEGER
) RETURNS TABLE(new_balance BIGINT) AS $$
BEGIN
  UPDATE lawcall_users
  SET
    credits = credits + p_amount,
    updated_at = now()
  WHERE kakao_user_id = p_kakao_user_id;

  RETURN QUERY
  SELECT credits FROM lawcall_users WHERE kakao_user_id = p_kakao_user_id;
END;
$$ LANGUAGE plpgsql;

-- Complete payment and add credits (atomic)
CREATE OR REPLACE FUNCTION complete_payment(
  p_order_id TEXT,
  p_payment_key TEXT,
  p_toss_response JSONB
) RETURNS TABLE(credits_added INTEGER, new_balance BIGINT) AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_new_balance BIGINT;
BEGIN
  -- Get payment info
  SELECT user_id, credits INTO v_user_id, v_credits
  FROM lawcall_payments
  WHERE order_id = p_order_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found or already processed';
  END IF;

  -- Update payment status
  UPDATE lawcall_payments
  SET
    status = 'completed',
    payment_key = p_payment_key,
    toss_response = p_toss_response,
    completed_at = now()
  WHERE order_id = p_order_id;

  -- Add credits to user
  UPDATE lawcall_users
  SET credits = credits + v_credits, updated_at = now()
  WHERE id = v_user_id
  RETURNING credits INTO v_new_balance;

  RETURN QUERY SELECT v_credits, v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Row Level Security (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lawcall_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lawcall_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE lawcall_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_sync ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON user_settings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON lawcall_users
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON lawcall_usage
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON lawcall_payments
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON memory_sync
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Action Permissions Table
-- ============================================

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kakao_user_id TEXT UNIQUE NOT NULL,

  -- Permissions array (JSONB)
  -- Each entry: { category, granted, grantedAt, expiresAt, scope, restrictions }
  permissions JSONB DEFAULT '[]',

  -- Global consent (false by default for safety)
  global_consent BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_kakao_id ON user_permissions(kakao_user_id);

-- ============================================
-- Action Audit Log Table
-- ============================================

CREATE TABLE IF NOT EXISTS action_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,

  -- Action info
  action TEXT NOT NULL,
  category TEXT,
  details JSONB DEFAULT '{}',

  -- Result
  result TEXT DEFAULT 'success', -- success, blocked, pending

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON action_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON action_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON action_audit_log(action);

-- ============================================
-- Pending Confirmations Table (Optional - for persistence)
-- ============================================

CREATE TABLE IF NOT EXISTS pending_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'pending', -- pending, approved, denied, expired
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_confirmations_user_id ON pending_confirmations(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status ON pending_confirmations(status);

-- ============================================
-- Security Events Table
-- ============================================

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,

  -- Event info
  event_type TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  severity TEXT DEFAULT 'info', -- info, warning, high, critical

  -- Source info
  ip_address TEXT,
  user_agent TEXT,
  device_id TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);

-- ============================================
-- Data Transfer Consents Table
-- ============================================

CREATE TABLE IF NOT EXISTS data_transfer_consents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,

  data_type TEXT NOT NULL,
  granted BOOLEAN DEFAULT false,
  destination TEXT,
  purpose TEXT,

  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_consents_user_id ON data_transfer_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_data_consents_data_type ON data_transfer_consents(data_type);

-- ============================================
-- Blocked IPs Table
-- ============================================

CREATE TABLE IF NOT EXISTS blocked_ips (
  ip_address TEXT PRIMARY KEY,
  reason TEXT,
  blocked_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  permanent BOOLEAN DEFAULT false
);

-- ============================================
-- Blocked Users Table
-- ============================================

CREATE TABLE IF NOT EXISTS blocked_users (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  blocked_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  permanent BOOLEAN DEFAULT false
);

-- ============================================
-- Trigger for updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER lawcall_users_updated_at
  BEFORE UPDATE ON lawcall_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

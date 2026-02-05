-- ============================================
-- MoA Remote Relay System - Supabase Schema
-- ============================================
-- Enables users to remotely control moltbot instances
-- on other devices via KakaoTalk through the MoA server.
--
-- Flow: Phone (KakaoTalk) → MoA Server → Supabase → Target Device (moltbot)
--
-- Run this SQL in your Supabase SQL Editor AFTER the main schema.

-- ============================================
-- Pairing Codes (temporary, for device registration)
-- ============================================
CREATE TABLE IF NOT EXISTS relay_pairing_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relay_pairing_code ON relay_pairing_codes(code) WHERE NOT used;

-- Auto-clean expired codes
CREATE OR REPLACE FUNCTION cleanup_expired_pairing_codes()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM relay_pairing_codes WHERE expires_at < NOW() OR used = true;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Relay Devices (registered devices that can receive commands)
-- ============================================
CREATE TABLE IF NOT EXISTS relay_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL UNIQUE,        -- HMAC auth token for polling
  device_name TEXT NOT NULL,                -- User-friendly name (e.g., "내 노트북", "사무실 PC")
  device_type TEXT NOT NULL DEFAULT 'desktop' CHECK (device_type IN ('desktop', 'laptop', 'server', 'mobile', 'tablet', 'other')),
  platform TEXT,                            -- OS info (e.g., "macOS", "Windows", "Linux")
  last_seen_at TIMESTAMPTZ,                -- Last heartbeat/poll time
  is_online BOOLEAN NOT NULL DEFAULT false, -- Whether device is actively polling
  capabilities TEXT[] DEFAULT '{}',         -- What the device can do (e.g., 'shell', 'file', 'browser')
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_name)
);

CREATE INDEX IF NOT EXISTS idx_relay_devices_user ON relay_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_relay_devices_token ON relay_devices(device_token);

-- ============================================
-- Relay Commands (command queue)
-- ============================================
CREATE TABLE IF NOT EXISTS relay_commands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  target_device_id UUID NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,

  -- Command data (encrypted at rest)
  encrypted_command TEXT NOT NULL,           -- AES-256-GCM encrypted command payload
  iv TEXT NOT NULL,                          -- Initialization vector
  auth_tag TEXT NOT NULL,                    -- GCM authentication tag

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_confirmation', 'delivered', 'executing', 'completed', 'failed', 'expired', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,       -- Higher = more urgent

  -- Safety analysis
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  safety_warnings TEXT[] DEFAULT '{}',       -- Warning messages from safety guard
  command_preview TEXT,                       -- Unencrypted short preview for confirmation UI
  execution_log JSONB DEFAULT '[]',           -- Progress updates from device during execution

  -- Result (encrypted)
  encrypted_result TEXT,                     -- AES-256-GCM encrypted result
  result_iv TEXT,
  result_auth_tag TEXT,
  result_summary TEXT,                       -- Unencrypted short summary for KakaoTalk reply

  -- Billing
  credits_charged INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_relay_commands_device_pending
  ON relay_commands(target_device_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_relay_commands_user ON relay_commands(user_id);
CREATE INDEX IF NOT EXISTS idx_relay_commands_expires ON relay_commands(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_relay_commands_awaiting
  ON relay_commands(user_id, status) WHERE status = 'awaiting_confirmation';

-- ============================================
-- Relay Usage Log (for billing analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS relay_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  command_id UUID REFERENCES relay_commands(id) ON DELETE SET NULL,
  credits_used INTEGER NOT NULL,
  action TEXT NOT NULL,                      -- 'command', 'result', 'heartbeat'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relay_usage_user ON relay_usage(user_id);

-- ============================================
-- Functions
-- ============================================

-- Claim pending commands for a device (atomic)
CREATE OR REPLACE FUNCTION claim_relay_commands(
  p_device_token TEXT,
  p_limit INTEGER DEFAULT 10
) RETURNS TABLE(
  command_id UUID,
  encrypted_command TEXT,
  iv TEXT,
  auth_tag TEXT,
  priority INTEGER,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  v_device_id UUID;
BEGIN
  -- Verify device token and get device ID
  SELECT id INTO v_device_id
  FROM relay_devices
  WHERE device_token = p_device_token;

  IF v_device_id IS NULL THEN
    RETURN;
  END IF;

  -- Update device last seen
  UPDATE relay_devices
  SET last_seen_at = NOW(), is_online = true
  WHERE id = v_device_id;

  -- Claim and return pending commands
  RETURN QUERY
  WITH claimed AS (
    UPDATE relay_commands
    SET status = 'delivered', delivered_at = NOW()
    WHERE id IN (
      SELECT rc.id
      FROM relay_commands rc
      WHERE rc.target_device_id = v_device_id
        AND rc.status = 'pending'
        AND rc.expires_at > NOW()
      ORDER BY rc.priority DESC, rc.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, relay_commands.encrypted_command, relay_commands.iv,
              relay_commands.auth_tag, relay_commands.priority, relay_commands.created_at
  )
  SELECT claimed.id, claimed.encrypted_command, claimed.iv,
         claimed.auth_tag, claimed.priority, claimed.created_at
  FROM claimed;
END;
$$ LANGUAGE plpgsql;

-- Submit command result
CREATE OR REPLACE FUNCTION submit_relay_result(
  p_command_id UUID,
  p_device_token TEXT,
  p_encrypted_result TEXT,
  p_result_iv TEXT,
  p_result_auth_tag TEXT,
  p_result_summary TEXT,
  p_status TEXT DEFAULT 'completed'
) RETURNS BOOLEAN AS $$
DECLARE
  v_device_id UUID;
BEGIN
  -- Verify device owns this command
  SELECT rd.id INTO v_device_id
  FROM relay_devices rd
  JOIN relay_commands rc ON rc.target_device_id = rd.id
  WHERE rd.device_token = p_device_token
    AND rc.id = p_command_id;

  IF v_device_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE relay_commands
  SET encrypted_result = p_encrypted_result,
      result_iv = p_result_iv,
      result_auth_tag = p_result_auth_tag,
      result_summary = p_result_summary,
      status = p_status,
      completed_at = NOW()
  WHERE id = p_command_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Expire old commands
CREATE OR REPLACE FUNCTION expire_relay_commands()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE relay_commands
  SET status = 'expired'
  WHERE status IN ('pending', 'awaiting_confirmation', 'delivered')
    AND expires_at < NOW();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Mark devices offline if no heartbeat for 5 minutes
CREATE OR REPLACE FUNCTION mark_offline_relay_devices()
RETURNS INTEGER AS $$
DECLARE
  offline_count INTEGER;
BEGIN
  UPDATE relay_devices
  SET is_online = false
  WHERE is_online = true
    AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '5 minutes');
  GET DIAGNOSTICS offline_count = ROW_COUNT;
  RETURN offline_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE relay_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on relay_pairing_codes"
  ON relay_pairing_codes FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on relay_devices"
  ON relay_devices FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on relay_commands"
  ON relay_commands FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on relay_usage"
  ON relay_usage FOR ALL USING (auth.role() = 'service_role');

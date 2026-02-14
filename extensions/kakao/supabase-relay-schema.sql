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

-- ============================================
-- MoA Subscriptions (유료 구독 서비스)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL UNIQUE,              -- Hashed kakao user ID
  plan TEXT NOT NULL DEFAULT 'free_trial' CHECK (plan IN ('free_trial', 'beta', 'basic', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'past_due')),
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,                      -- NULL for beta/unlimited
  trial_ends_at TIMESTAMPTZ,                 -- When free trial ends
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  payment_method TEXT,                       -- Payment method identifier
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_subscriptions_user ON moa_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_moa_subscriptions_status ON moa_subscriptions(status) WHERE status = 'active';

-- ============================================
-- Payment History (결제 이력)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID REFERENCES moa_subscriptions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,                   -- 결제 금액 (원)
  currency TEXT NOT NULL DEFAULT 'KRW',
  payment_method TEXT,                       -- 결제 수단 (카드, 카카오페이 등)
  payment_provider TEXT,                     -- 결제사 (토스, 아임포트 등)
  transaction_id TEXT,                       -- 외부 결제사 거래 ID
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_payments_user ON moa_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_moa_payments_subscription ON moa_payments(subscription_id);

-- ============================================
-- Daily Usage Tracking (일일 사용량 추적)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_daily_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  commands_sent INTEGER NOT NULL DEFAULT 0,
  devices_active INTEGER NOT NULL DEFAULT 0,
  memory_syncs INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_moa_daily_usage_user_date ON moa_daily_usage(user_id, date);

-- Increment daily usage
CREATE OR REPLACE FUNCTION increment_daily_usage(
  p_user_id TEXT,
  p_command_count INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO moa_daily_usage (user_id, date, commands_sent)
  VALUES (p_user_id, CURRENT_DATE, p_command_count)
  ON CONFLICT (user_id, date)
  DO UPDATE SET commands_sent = moa_daily_usage.commands_sent + p_command_count;
END;
$$ LANGUAGE plpgsql;

-- Check daily limit
CREATE OR REPLACE FUNCTION check_daily_limit(
  p_user_id TEXT,
  p_daily_limit INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  current_count INTEGER;
BEGIN
  SELECT COALESCE(commands_sent, 0) INTO current_count
  FROM moa_daily_usage
  WHERE user_id = p_user_id AND date = CURRENT_DATE;

  RETURN COALESCE(current_count, 0) < p_daily_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS for new tables
-- ============================================
ALTER TABLE moa_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE moa_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE moa_daily_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on moa_subscriptions"
  ON moa_subscriptions FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on moa_payments"
  ON moa_payments FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on moa_daily_usage"
  ON moa_daily_usage FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Device Activity Log (연결/명령 이벤트 로깅)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_device_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('connect', 'disconnect', 'command_start', 'command_end', 'heartbeat', 'error')),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_device_activity_device ON moa_device_activity(device_id);
CREATE INDEX IF NOT EXISTS idx_moa_device_activity_type ON moa_device_activity(type);
CREATE INDEX IF NOT EXISTS idx_moa_device_activity_created ON moa_device_activity(created_at DESC);

-- Auto-cleanup old activity logs (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_device_activity()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM moa_device_activity
  WHERE created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- MoA Memory Storage (쌍둥이 MoA 기억 동기화)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,                     -- Hashed kakao user ID
  type TEXT NOT NULL CHECK (type IN ('conversation', 'preference', 'knowledge', 'command_pattern')),
  key TEXT NOT NULL,                         -- Unique key within user's memory
  content JSONB NOT NULL,                    -- Memory content
  importance INTEGER NOT NULL DEFAULT 50 CHECK (importance >= 0 AND importance <= 100),
  source_device_id UUID REFERENCES relay_devices(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,        -- For conflict resolution
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_moa_memory_user ON moa_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_moa_memory_type ON moa_memory(user_id, type);
CREATE INDEX IF NOT EXISTS idx_moa_memory_updated ON moa_memory(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_moa_memory_importance ON moa_memory(user_id, importance DESC);

-- ============================================
-- Sync Events (동기화 이력)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_sync_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  device_id UUID REFERENCES relay_devices(id) ON DELETE SET NULL,
  uploaded INTEGER NOT NULL DEFAULT 0,
  downloaded INTEGER NOT NULL DEFAULT 0,
  conflicts_resolved INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_sync_events_user ON moa_sync_events(user_id);
CREATE INDEX IF NOT EXISTS idx_moa_sync_events_device ON moa_sync_events(device_id);

-- ============================================
-- RLS for activity and memory tables
-- ============================================
ALTER TABLE moa_device_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE moa_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE moa_sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on moa_device_activity"
  ON moa_device_activity FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on moa_memory"
  ON moa_memory FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on moa_sync_events"
  ON moa_sync_events FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- LLM Credits System (LLM API 크레딧)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_credits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL UNIQUE,               -- Hashed kakao user ID
  balance INTEGER NOT NULL DEFAULT 0,         -- 현재 크레딧 잔액
  total_purchased INTEGER NOT NULL DEFAULT 0, -- 총 구매한 크레딧
  total_used INTEGER NOT NULL DEFAULT 0,      -- 총 사용한 크레딧
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_credits_user ON moa_credits(user_id);

-- ============================================
-- Credit History (크레딧 변동 이력)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_credit_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,                    -- 변동량 (+구매, -사용)
  type TEXT NOT NULL CHECK (type IN ('purchase', 'usage', 'bonus', 'refund', 'admin')),
  reason TEXT NOT NULL,                       -- 변동 사유
  balance_after INTEGER NOT NULL,             -- 변동 후 잔액
  model TEXT,                                 -- LLM 모델 (사용 시)
  tokens_used INTEGER,                        -- 토큰 사용량 (사용 시)
  order_id TEXT,                              -- 주문 ID (구매 시)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_credit_history_user ON moa_credit_history(user_id);
CREATE INDEX IF NOT EXISTS idx_moa_credit_history_type ON moa_credit_history(type);
CREATE INDEX IF NOT EXISTS idx_moa_credit_history_created ON moa_credit_history(created_at DESC);

-- ============================================
-- Credit Purchases (크레딧 구매 기록)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_credit_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,                   -- 패키지 ID (credits_1000, credits_5000 등)
  credits_purchased INTEGER NOT NULL,         -- 구매한 크레딧
  bonus_credits INTEGER NOT NULL DEFAULT 0,   -- 보너스 크레딧
  amount INTEGER NOT NULL,                    -- 결제 금액
  currency TEXT NOT NULL DEFAULT 'KRW',       -- 통화 (KRW, USD)
  provider TEXT NOT NULL,                     -- 결제사 (toss, kakao, stripe)
  payment_key TEXT,                           -- 결제 키
  order_id TEXT NOT NULL UNIQUE,              -- 주문 ID
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moa_credit_purchases_user ON moa_credit_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_moa_credit_purchases_order ON moa_credit_purchases(order_id);
CREATE INDEX IF NOT EXISTS idx_moa_credit_purchases_status ON moa_credit_purchases(status);

-- Add credit-related columns to moa_subscriptions (if not exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_subscriptions' AND column_name = 'payment_key') THEN
    ALTER TABLE moa_subscriptions ADD COLUMN payment_key TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_subscriptions' AND column_name = 'monthly_price') THEN
    ALTER TABLE moa_subscriptions ADD COLUMN monthly_price INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_subscriptions' AND column_name = 'cancelled_at') THEN
    ALTER TABLE moa_subscriptions ADD COLUMN cancelled_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_subscriptions' AND column_name = 'cancel_reason') THEN
    ALTER TABLE moa_subscriptions ADD COLUMN cancel_reason TEXT;
  END IF;
END
$$;

-- Add columns to moa_payments for Stripe/global payments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_payments' AND column_name = 'order_id') THEN
    ALTER TABLE moa_payments ADD COLUMN order_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_payments' AND column_name = 'payment_key') THEN
    ALTER TABLE moa_payments ADD COLUMN payment_key TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_payments' AND column_name = 'provider') THEN
    ALTER TABLE moa_payments ADD COLUMN provider TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'moa_payments' AND column_name = 'plan_type') THEN
    ALTER TABLE moa_payments ADD COLUMN plan_type TEXT;
  END IF;
END
$$;

-- ============================================
-- RLS for credit tables
-- ============================================
ALTER TABLE moa_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE moa_credit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE moa_credit_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on moa_credits"
  ON moa_credits FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on moa_credit_history"
  ON moa_credit_history FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on moa_credit_purchases"
  ON moa_credit_purchases FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Device Location Tracking (분실 기기 GPS 추적)
-- ============================================
-- 분실 신고 시 원격 삭제와 동시에 GPS 좌표를 실시간으로 전송하여
-- 분실 기기를 회수할 수 있도록 합니다.

-- 추적 세션 (분실 기기당 1개 활성 세션)
CREATE TABLE IF NOT EXISTS device_location_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  device_id UUID NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  -- 추적 상태: active(진행중), paused(일시정지), completed(완료), expired(만료)
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'expired')),
  -- 추적 설정
  interval_sec INTEGER NOT NULL DEFAULT 30,        -- GPS 수집 간격 (초)
  high_accuracy BOOLEAN NOT NULL DEFAULT true,     -- 고정밀 GPS 모드
  -- 마지막 수신 위치 (빠른 조회용 denormalized)
  last_latitude DOUBLE PRECISION,
  last_longitude DOUBLE PRECISION,
  last_accuracy DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  -- 통계
  total_points INTEGER NOT NULL DEFAULT 0,
  -- 연결된 wipe 명령
  wipe_command_id UUID REFERENCES device_wipe_commands(id) ON DELETE SET NULL,
  -- 타임스탬프
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_location_sessions_user_device
  ON device_location_sessions(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_location_sessions_active
  ON device_location_sessions(device_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_location_sessions_expires
  ON device_location_sessions(expires_at) WHERE status = 'active';

-- 위치 기록 (개별 GPS 좌표)
CREATE TABLE IF NOT EXISTS device_location_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES device_location_sessions(id) ON DELETE CASCADE,
  -- GPS 좌표
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION NOT NULL DEFAULT 0,     -- 정확도 (미터)
  altitude DOUBLE PRECISION,                        -- 고도 (미터)
  speed DOUBLE PRECISION,                           -- 속도 (m/s)
  bearing DOUBLE PRECISION,                         -- 방향 (0-360도)
  provider TEXT DEFAULT 'fused'                     -- gps, network, fused
    CHECK (provider IN ('gps', 'network', 'fused')),
  -- 기기 상태
  battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
  network_type TEXT CHECK (network_type IN ('wifi', 'cellular', 'none')),
  is_moving BOOLEAN,
  -- 타임스탬프
  measured_at TIMESTAMPTZ NOT NULL,                 -- GPS 측정 시각
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()     -- 서버 수신 시각
);

CREATE INDEX IF NOT EXISTS idx_location_entries_session
  ON device_location_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_location_entries_time
  ON device_location_entries(session_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_entries_cleanup
  ON device_location_entries(created_at) WHERE created_at < NOW() - INTERVAL '30 days';

-- 오래된 위치 데이터 자동 삭제 (30일)
CREATE OR REPLACE FUNCTION cleanup_old_location_entries()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM device_location_entries
  WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 만료된 추적 세션 자동 종료
CREATE OR REPLACE FUNCTION expire_location_sessions()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE device_location_sessions
  SET status = 'expired', ended_at = NOW()
  WHERE status = 'active'
    AND expires_at < NOW();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE device_location_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_location_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on device_location_sessions"
  ON device_location_sessions FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on device_location_entries"
  ON device_location_entries FOR ALL USING (auth.role() = 'service_role');


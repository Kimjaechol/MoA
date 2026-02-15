-- ============================================
-- MoA Push Token Schema
-- ============================================
-- FCM/APNs 푸시 토큰 저장을 위한 스키마
-- 3계층 무료 우선 발송 체계의 2계층(FCM/APNs)에 사용
--
-- Run this SQL in Supabase SQL Editor AFTER the relay schema.

-- ============================================
-- Push Tokens (디바이스별 푸시 토큰)
-- ============================================
-- relay_devices에 push_token, push_platform 컬럼 추가
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'relay_devices' AND column_name = 'push_token') THEN
    ALTER TABLE relay_devices ADD COLUMN push_token TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'relay_devices' AND column_name = 'push_platform') THEN
    ALTER TABLE relay_devices ADD COLUMN push_platform TEXT CHECK (push_platform IN ('fcm', 'apns'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'relay_devices' AND column_name = 'push_token_updated_at') THEN
    ALTER TABLE relay_devices ADD COLUMN push_token_updated_at TIMESTAMPTZ;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_relay_devices_push_token
  ON relay_devices(push_token) WHERE push_token IS NOT NULL;

-- ============================================
-- Notification Queue (발송 실패 시 재시도 큐)
-- ============================================
CREATE TABLE IF NOT EXISTS moa_notification_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES relay_devices(id) ON DELETE SET NULL,
  -- 메시지 내용
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  -- 발송 상태
  tier1_gateway_tried BOOLEAN NOT NULL DEFAULT false,
  tier1_gateway_success BOOLEAN,
  tier2_push_tried BOOLEAN NOT NULL DEFAULT false,
  tier2_push_success BOOLEAN,
  tier3_kakao_tried BOOLEAN NOT NULL DEFAULT false,
  tier3_kakao_success BOOLEAN,
  -- 최종 결과
  delivered BOOLEAN NOT NULL DEFAULT false,
  delivery_method TEXT CHECK (delivery_method IN ('gateway', 'fcm', 'apns', 'alimtalk', 'friendtalk', 'failed')),
  error_log JSONB DEFAULT '[]',
  -- 타임스탬프
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_user
  ON moa_notification_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
  ON moa_notification_queue(delivered, created_at) WHERE NOT delivered;

-- 만료된 알림 정리
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM moa_notification_queue
  WHERE expires_at < NOW() OR (delivered = true AND created_at < NOW() - INTERVAL '7 days');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE moa_notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on moa_notification_queue"
  ON moa_notification_queue FOR ALL USING (auth.role() = 'service_role');

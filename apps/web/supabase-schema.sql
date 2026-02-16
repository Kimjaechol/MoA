-- ============================================
-- MoA Website — Supabase Schema
-- Run this in Supabase SQL Editor to create tables
--
-- IMPORTANT: All API routes use the service key (bypasses RLS).
-- RLS policies below serve as defense-in-depth if anon key is
-- ever exposed. The real access control is in the API layer.
-- ============================================

-- ============================================
-- 0. Users & Sessions (사용자 인증)
-- 3중 보안: 아이디/비밀번호 + 구문번호 + 기기인증
-- ============================================

CREATE TABLE IF NOT EXISTS moa_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,          -- e.g. "user_1738000000_abc123"
  username TEXT NOT NULL UNIQUE,          -- login username (lowercase)
  display_name TEXT,
  password_hash TEXT NOT NULL,            -- scrypt hash (salt:hash)
  passphrase_hash TEXT NOT NULL,          -- 구문번호 scrypt hash
  phone TEXT,                            -- E.164 format (e.g. "+821012345678")
  country_code TEXT,                     -- ISO 3166-1 alpha-2 (e.g. "KR")
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  email_verification_token TEXT,         -- verification token for email confirmation
  email_verification_expires TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,              -- account lockout after failed attempts
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_users ENABLE ROW LEVEL SECURITY;

-- Migration: ensure all columns exist (safe to re-run)
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS passphrase_hash TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- No anon access to users table (service key only)
-- No USING(true) policy — any anon query returns zero rows

CREATE INDEX IF NOT EXISTS idx_users_user_id ON moa_users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON moa_users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON moa_users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON moa_users(phone);

-- Sessions (서버 사이드 세션 관리)
CREATE TABLE IF NOT EXISTS moa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_sessions ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE moa_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE moa_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE moa_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE moa_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- No anon access to sessions table (service key only)

CREATE INDEX IF NOT EXISTS idx_sessions_token ON moa_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON moa_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON moa_sessions(expires_at);

-- ============================================
-- 1. Feedback (건의사항/버그 신고) — 관리자만 조회 가능
-- ============================================

CREATE TABLE IF NOT EXISTS moa_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  email TEXT,
  content TEXT NOT NULL,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved')),
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: No anon access (service key only)
ALTER TABLE moa_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE moa_feedback ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_feedback_email ON moa_feedback(email);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON moa_feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON moa_feedback(created_at DESC);

-- ============================================
-- 2. Community Posts (커뮤니티 게시판) — public read OK
-- ============================================

CREATE TABLE IF NOT EXISTS moa_community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  email TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_community_posts ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_community_posts ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE moa_community_posts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE moa_community_posts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE moa_community_posts ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE moa_community_posts ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE moa_community_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Public board: anon reads OK
DROP POLICY IF EXISTS "Public read access" ON moa_community_posts;
CREATE POLICY "Public read access" ON moa_community_posts
  FOR SELECT USING (true);

-- 3. Community Likes (좋아요)
CREATE TABLE IF NOT EXISTS moa_community_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES moa_community_posts(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, visitor_id)
);

ALTER TABLE moa_community_likes ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_community_likes ADD COLUMN IF NOT EXISTS post_id UUID;
ALTER TABLE moa_community_likes ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE moa_community_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP POLICY IF EXISTS "Public read access" ON moa_community_likes;
CREATE POLICY "Public read access" ON moa_community_likes
  FOR SELECT USING (true);

-- 4. Community Comments (댓글)
CREATE TABLE IF NOT EXISTS moa_community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES moa_community_posts(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_community_comments ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_community_comments ADD COLUMN IF NOT EXISTS post_id UUID;
ALTER TABLE moa_community_comments ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE moa_community_comments ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE moa_community_comments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP POLICY IF EXISTS "Public read access" ON moa_community_comments;
CREATE POLICY "Public read access" ON moa_community_comments
  FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_posts_created ON moa_community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post ON moa_community_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_visitor ON moa_community_likes(visitor_id);
CREATE INDEX IF NOT EXISTS idx_comments_post ON moa_community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON moa_community_comments(created_at ASC);

-- ============================================
-- 5. Use Case Posts (사용사례 게시판) — public read OK
-- ============================================

CREATE TABLE IF NOT EXISTS moa_usecase_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  email TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_usecase_posts ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_usecase_posts ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE moa_usecase_posts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE moa_usecase_posts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE moa_usecase_posts ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE moa_usecase_posts ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE moa_usecase_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP POLICY IF EXISTS "Public read access" ON moa_usecase_posts;
CREATE POLICY "Public read access" ON moa_usecase_posts
  FOR SELECT USING (true);

-- 6. Use Case Likes (사용사례 좋아요)
CREATE TABLE IF NOT EXISTS moa_usecase_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES moa_usecase_posts(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, visitor_id)
);

ALTER TABLE moa_usecase_likes ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_usecase_likes ADD COLUMN IF NOT EXISTS post_id UUID;
ALTER TABLE moa_usecase_likes ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE moa_usecase_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP POLICY IF EXISTS "Public read access" ON moa_usecase_likes;
CREATE POLICY "Public read access" ON moa_usecase_likes
  FOR SELECT USING (true);

-- 7. Use Case Comments (사용사례 댓글)
CREATE TABLE IF NOT EXISTS moa_usecase_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES moa_usecase_posts(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_usecase_comments ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_usecase_comments ADD COLUMN IF NOT EXISTS post_id UUID;
ALTER TABLE moa_usecase_comments ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE moa_usecase_comments ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE moa_usecase_comments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP POLICY IF EXISTS "Public read access" ON moa_usecase_comments;
CREATE POLICY "Public read access" ON moa_usecase_comments
  FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_usecase_posts_created ON moa_usecase_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usecase_likes_post ON moa_usecase_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_usecase_likes_visitor ON moa_usecase_likes(visitor_id);
CREATE INDEX IF NOT EXISTS idx_usecase_comments_post ON moa_usecase_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_usecase_comments_created ON moa_usecase_comments(created_at ASC);

-- ============================================
-- 8. User API Keys (사용자 API 키 관리)
-- Keys are encrypted with AES-256-GCM at application level.
-- ============================================

CREATE TABLE IF NOT EXISTS moa_user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN (
    'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'mistral', 'xai'
  )),
  -- API key is encrypted at app level (AES-256-GCM) before storing
  encrypted_key TEXT NOT NULL,
  -- Display label e.g. "sk-...abc" (first 4 + last 4 chars)
  key_hint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE moa_user_api_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS key_hint TEXT;
ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_user_api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- No anon access — API keys are sensitive (service key only)

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON moa_user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_provider ON moa_user_api_keys(user_id, provider);

-- ============================================
-- 9. User Model Strategy Settings
-- ============================================

CREATE TABLE IF NOT EXISTS moa_user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  model_strategy TEXT NOT NULL DEFAULT 'cost-efficient' CHECK (model_strategy IN ('cost-efficient', 'max-performance')),
  -- Phone & KakaoTalk
  phone TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  kakao_channel_added BOOLEAN NOT NULL DEFAULT false,
  -- Free trial tracking
  trial_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_days INTEGER NOT NULL DEFAULT 30,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_user_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS model_strategy TEXT DEFAULT 'cost-efficient';
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS preferred_provider TEXT;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS preferred_model TEXT;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS kakao_channel_added BOOLEAN DEFAULT false;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 30;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_user_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- No anon access — settings contain phone numbers (service key only)

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON moa_user_settings(user_id);

-- ============================================
-- 10. Chat Messages (웹 채팅 메시지)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web',
  category TEXT DEFAULT 'other',
  model_used TEXT,
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'web';
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other';
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS token_count INTEGER;
ALTER TABLE moa_chat_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- No anon access — chat messages are private (service key only)

CREATE INDEX IF NOT EXISTS idx_chat_user ON moa_chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_session ON moa_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON moa_chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_category ON moa_chat_messages(category);

-- ============================================
-- 11. Channel Connections (채널 연결 상태)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_channel_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  UNIQUE(channel, channel_user_id)
);

ALTER TABLE moa_channel_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS channel_user_id TEXT;
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_channel_connections ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- No anon access (service key only)

-- Primary lookup: find MoA user by channel identity
CREATE INDEX IF NOT EXISTS idx_channel_conn_lookup ON moa_channel_connections(channel, channel_user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_channel_conn_user ON moa_channel_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_conn_channel ON moa_channel_connections(user_id, channel);

-- Migration: update existing unique constraint (safe to run)
-- DROP the old (user_id, channel) constraint and add (channel, channel_user_id)
-- Run manually if migrating: ALTER TABLE moa_channel_connections DROP CONSTRAINT IF EXISTS moa_channel_connections_user_id_channel_key;
-- Then: ALTER TABLE moa_channel_connections ADD CONSTRAINT moa_channel_connections_channel_channel_user_id_key UNIQUE(channel, channel_user_id);

-- ============================================
-- 12. Synthesis Jobs (문서작업 기록)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_synthesis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  output_format TEXT NOT NULL DEFAULT 'report',
  output_length TEXT NOT NULL DEFAULT 'medium',
  language TEXT NOT NULL DEFAULT 'ko',
  model_used TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE moa_synthesis_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS source_count INTEGER DEFAULT 0;
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS output_format TEXT DEFAULT 'report';
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS output_length TEXT DEFAULT 'medium';
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'ko';
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS result_content TEXT;
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_synthesis_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- No anon access (service key only)

CREATE INDEX IF NOT EXISTS idx_synthesis_user ON moa_synthesis_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_synthesis_created ON moa_synthesis_jobs(created_at DESC);

-- ============================================
-- 13. Auto-Code Sessions (AI 코딩작업 세션)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_autocode_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  framework TEXT NOT NULL DEFAULT 'nextjs',
  model_used TEXT,
  max_iterations INTEGER NOT NULL DEFAULT 10,
  completed_iterations INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  fix_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'complete', 'failed')),
  final_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE moa_autocode_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS framework TEXT DEFAULT 'nextjs';
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS max_iterations INTEGER DEFAULT 10;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS completed_iterations INTEGER DEFAULT 0;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS fix_count INTEGER DEFAULT 0;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'idle';
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS final_code TEXT;
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_autocode_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- No anon access (service key only)

CREATE INDEX IF NOT EXISTS idx_autocode_user ON moa_autocode_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_autocode_created ON moa_autocode_sessions(created_at DESC);

-- ============================================
-- 14. Credits (크레딧 잔액)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 100,  -- free tier starts with 100
  monthly_quota INTEGER NOT NULL DEFAULT 100,
  monthly_used INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro')),
  quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_credits ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 100;
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS monthly_quota INTEGER DEFAULT 100;
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS monthly_used INTEGER DEFAULT 0;
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS quota_reset_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days');
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_credits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- No anon access (service key only)

CREATE INDEX IF NOT EXISTS idx_credits_user ON moa_credits(user_id);

-- ============================================
-- 15. Credit Transactions (크레딧 사용/충전 내역)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,            -- positive=charge, negative=usage
  balance_after INTEGER NOT NULL,     -- balance after this transaction
  tx_type TEXT NOT NULL CHECK (tx_type IN (
    'usage', 'purchase', 'subscription', 'bonus', 'refund', 'monthly_reset'
  )),
  description TEXT,                   -- e.g. "채팅 - anthropic/claude-opus-4-6"
  model_used TEXT,                    -- model that consumed credits (for usage)
  reference_id TEXT,                  -- payment_id or session_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_credit_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS balance_after INTEGER;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS tx_type TEXT;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE moa_credit_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- No anon access (service key only)

CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON moa_credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_created ON moa_credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON moa_credit_transactions(user_id, tx_type);

-- ============================================
-- 16. Subscriptions (구독 관리)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'expired', 'past_due')),
  amount INTEGER NOT NULL,            -- 9900 or 29900 (KRW)
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  canceled_at TIMESTAMPTZ,
  payment_method TEXT,               -- card_last4 or method label
  portone_billing_key TEXT,          -- for PortOne recurring billing
  stripe_subscription_id TEXT,       -- Stripe subscription ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly';
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days');
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS portone_billing_key TEXT;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE moa_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- No anon access (service key only)

CREATE INDEX IF NOT EXISTS idx_sub_user ON moa_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_status ON moa_subscriptions(user_id, status);

-- ============================================
-- 17. Payments (결제 기록)
-- ============================================

CREATE TABLE IF NOT EXISTS moa_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  payment_id TEXT NOT NULL UNIQUE,     -- PortOne merchant_uid or Stripe ref
  imp_uid TEXT,                        -- PortOne imp_uid
  stripe_session_id TEXT,              -- Stripe Checkout Session ID
  pay_method TEXT,                     -- card, kakao, naverpay, tosspay, etc.
  amount INTEGER NOT NULL,             -- KRW or USD cents
  currency TEXT DEFAULT 'krw',         -- 'krw' or 'usd'
  payment_gateway TEXT DEFAULT 'portone', -- 'portone' or 'stripe'
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'paid', 'failed', 'canceled', 'refunded'
  )),
  product_type TEXT NOT NULL CHECK (product_type IN ('credit_pack', 'subscription')),
  product_name TEXT NOT NULL,          -- e.g. "크레딧 500", "Basic Monthly"
  credits_granted INTEGER DEFAULT 0,   -- credits added on success
  card_name TEXT,
  card_number TEXT,                    -- masked: ****-****-****-1234
  receipt_url TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE moa_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS imp_uid TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS pay_method TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'krw';
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'portone';
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS credits_granted INTEGER DEFAULT 0;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS card_name TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS card_number TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE moa_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- No anon access (service key only)

CREATE INDEX IF NOT EXISTS idx_payments_user ON moa_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_pid ON moa_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway ON moa_payments(payment_gateway);
CREATE INDEX IF NOT EXISTS idx_payments_stripe ON moa_payments(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON moa_payments(created_at DESC);

-- ============================================
-- Migration helper: drop old overly-permissive RLS policies
-- Run this ONCE on existing databases that have the old USING(true) policies.
-- ============================================

-- DROP POLICY IF EXISTS "Users read own keys" ON moa_user_api_keys;
-- DROP POLICY IF EXISTS "Users read own settings" ON moa_user_settings;
-- DROP POLICY IF EXISTS "Users read own messages" ON moa_chat_messages;
-- DROP POLICY IF EXISTS "Users read own connections" ON moa_channel_connections;
-- DROP POLICY IF EXISTS "Users read own synthesis jobs" ON moa_synthesis_jobs;
-- DROP POLICY IF EXISTS "Users read own autocode sessions" ON moa_autocode_sessions;
-- DROP POLICY IF EXISTS "Users read own credits" ON moa_credits;
-- DROP POLICY IF EXISTS "Users read own transactions" ON moa_credit_transactions;
-- DROP POLICY IF EXISTS "Users read own subscriptions" ON moa_subscriptions;
-- DROP POLICY IF EXISTS "Users read own payments" ON moa_payments;

-- ============================================
-- Security Audit Log (보안 감사 로그)
-- Records security events for monitoring and forensics.
-- User IDs are stored as SHA-256 hashes for privacy.
-- ============================================

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

-- No anon access (service key only, read-only for admins)

CREATE INDEX IF NOT EXISTS idx_security_audit_type ON moa_security_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_severity ON moa_security_audit_log(severity) WHERE severity IN ('warning', 'critical');
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON moa_security_audit_log(created_at DESC);

-- Auto-purge old info-level logs after 90 days (run periodically)
-- DELETE FROM moa_security_audit_log WHERE severity = 'info' AND created_at < now() - interval '90 days';
-- Critical/warning logs should be retained longer for forensics.

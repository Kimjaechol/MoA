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
-- Sample Data (Optional - for testing)
-- ============================================
-- INSERT INTO lawcall_users (kakao_user_id, credits) VALUES ('test_user_001', 10000);

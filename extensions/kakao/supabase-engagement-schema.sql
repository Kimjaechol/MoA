-- MoA Channel Engagement Schema
-- Run this SQL in your Supabase SQL Editor AFTER the main supabase-schema.sql
--
-- Adds columns for:
-- 1. Channel friend tracking
-- 2. Weather notification preferences
-- 3. Referral system
-- 4. Phone number storage (for AlimTalk/FriendTalk)

-- ============================================
-- Add engagement columns to lawcall_users
-- ============================================

-- Phone number for proactive messaging (AlimTalk/FriendTalk)
ALTER TABLE lawcall_users ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Whether user is a KakaoTalk channel friend
ALTER TABLE lawcall_users ADD COLUMN IF NOT EXISTS is_channel_friend BOOLEAN DEFAULT FALSE;

-- When channel join invitation was sent
ALTER TABLE lawcall_users ADD COLUMN IF NOT EXISTS channel_invite_sent_at TIMESTAMPTZ;

-- Weather notification opt-out (default: receive notifications)
ALTER TABLE lawcall_users ADD COLUMN IF NOT EXISTS weather_opt_out BOOLEAN DEFAULT FALSE;

-- Referral code for sharing
ALTER TABLE lawcall_users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Index for referral code lookup
CREATE INDEX IF NOT EXISTS idx_lawcall_users_referral_code ON lawcall_users(referral_code);

-- Index for channel friends (for daily weather sending)
CREATE INDEX IF NOT EXISTS idx_lawcall_users_channel_friend ON lawcall_users(is_channel_friend)
  WHERE is_channel_friend = TRUE;

-- ============================================
-- Referrals Table
-- ============================================
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES lawcall_users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  bonus_credits INTEGER NOT NULL DEFAULT 500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_id ON referrals(referred_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_unique_pair
  ON referrals(referrer_id, referred_id);

-- ============================================
-- Function: add_credits (safe atomic credit addition)
-- ============================================
CREATE OR REPLACE FUNCTION add_credits(user_id UUID, amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE lawcall_users
  SET credits = credits + amount,
      updated_at = NOW()
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql;

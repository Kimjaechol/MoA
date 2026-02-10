-- ============================================
-- MoA Website — Supabase Schema
-- Run this in Supabase SQL Editor to create tables
-- ============================================

-- 1. Feedback (건의사항/버그 신고) — 작성자+관리자만 조회 가능
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

-- RLS: Only service key can read/write (enforced via API routes)
ALTER TABLE moa_feedback ENABLE ROW LEVEL SECURITY;

-- 2. Community Posts (사용사례 게시판)
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

-- Allow anonymous reads for community posts (public board)
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

CREATE POLICY "Public read access" ON moa_community_comments
  FOR SELECT USING (true);

-- ============================================
-- Indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_feedback_email ON moa_feedback(email);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON moa_feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON moa_feedback(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_created ON moa_community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post ON moa_community_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_visitor ON moa_community_likes(visitor_id);
CREATE INDEX IF NOT EXISTS idx_comments_post ON moa_community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON moa_community_comments(created_at ASC);

-- ============================================
-- 5. Use Case Posts (사용사례 게시판)
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

CREATE POLICY "Public read access" ON moa_usecase_comments
  FOR SELECT USING (true);

-- Use Case Indexes
CREATE INDEX IF NOT EXISTS idx_usecase_posts_created ON moa_usecase_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usecase_likes_post ON moa_usecase_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_usecase_likes_visitor ON moa_usecase_likes(visitor_id);
CREATE INDEX IF NOT EXISTS idx_usecase_comments_post ON moa_usecase_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_usecase_comments_created ON moa_usecase_comments(created_at ASC);

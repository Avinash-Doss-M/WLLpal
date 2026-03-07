-- ═══════════════════════════════════════
--  WELLPAL AUTH MIGRATION
--  Run this in Supabase SQL Editor
--  https://supabase.com/dashboard/project/mhcsydopmhgdxvpxllyu/sql/new
-- ═══════════════════════════════════════

-- 1. Add auth_id column to link with Supabase Auth users
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE;

-- 2. Create index for fast lookup by auth_id
CREATE INDEX IF NOT EXISTS idx_profiles_auth_id ON user_profiles(auth_id);

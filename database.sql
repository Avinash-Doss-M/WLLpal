-- ═══════════════════════════════════════
--  WELLPAL DATABASE SETUP
--  Run this entire block in Supabase SQL Editor
--  https://supabase.com/dashboard/project/mhcsydopmhgdxvpxllyu/sql/new
-- ═══════════════════════════════════════

-- 1. USER PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    name TEXT NOT NULL DEFAULT 'User',
    age TEXT,
    gender TEXT DEFAULT 'Prefer not to say',
    location TEXT,
    email TEXT,
    phone TEXT,
    height TEXT,
    weight TEXT,
    blood_type TEXT DEFAULT 'Unknown',
    allergies TEXT[] DEFAULT '{}'
);

-- 2. CHAT SESSIONS
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. CHAT MESSAGES
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. INDEXES
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_profile ON chat_sessions(profile_id, updated_at DESC);

-- 5. ROW LEVEL SECURITY (open for demo)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY allow_all_profiles ON user_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_sessions ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_messages ON chat_messages FOR ALL USING (true) WITH CHECK (true);

-- 6. AUTO-UPDATE TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON chat_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7. INSERT DEFAULT PROFILE
INSERT INTO user_profiles (name, age, gender, location, email, phone, height, weight, blood_type, allergies)
VALUES ('Arjun Mehta', '32', 'Male', 'Chennai, Tamil Nadu', 'arjun@wellpal.health', '+91 98765 43210', '5''10" (178 cm)', '74 kg', 'B+', ARRAY['Nut Allergy']);

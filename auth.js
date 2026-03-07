// ═══════════════════════════════════════
//  WELLPAL AUTH HELPER — shared across all pages
// ═══════════════════════════════════════

const WellpalAuth = {
  // Get stored session
  getSession() {
    try {
      const raw = localStorage.getItem('wellpal_session');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  // Save session after login/signup
  saveSession(data) {
    console.log('💾 saveSession keys:', Object.keys(data));
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user || null,
      expires_at: data.expires_at || (data.expires_in ? Date.now() + data.expires_in * 1000 : null)
    };
    console.log('💾 Session user:', session.user ? `id=${session.user.id}, email=${session.user.email}` : 'NULL');
    localStorage.setItem('wellpal_session', JSON.stringify(session));
  },

  // Clear session
  clearSession() {
    localStorage.removeItem('wellpal_session');
  },

  // Check if logged in
  isLoggedIn() {
    const s = this.getSession();
    return !!(s && s.access_token && s.user);
  },

  // Get the auth user id
  getUserId() {
    const s = this.getSession();
    return s?.user?.id || null;
  },

  // Get user email
  getUserEmail() {
    const s = this.getSession();
    return s?.user?.email || null;
  },

  // Get user name from metadata
  getUserName() {
    const s = this.getSession();
    return s?.user?.user_metadata?.name || s?.user?.email?.split('@')[0] || 'User';
  },

  // Sign up
  async signup(email, password, name) {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });
    const data = await res.json();
    console.log('signup() raw response:', res.status, JSON.stringify(data).substring(0, 300));
    if (!res.ok || data.error) throw new Error(data.error || data.msg || `Signup failed (${res.status})`);
    // Supabase may return session directly or require email confirmation
    if (data.access_token) {
      this.saveSession(data);
    }
    return data;
  },

  // Login
  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    console.log('login() raw response:', res.status, JSON.stringify(data).substring(0, 300));
    if (!res.ok || data.error) throw new Error(data.error || data.msg || `Login failed (${res.status})`);
    this.saveSession(data);
    return data;
  },

  // Logout
  async logout() {
    const s = this.getSession();
    if (s?.access_token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: s.access_token })
        });
      } catch(e) { console.log('Logout API:', e); }
    }
    this.clearSession();
    window.location.href = 'auth.html';
  },

  // Load the user's profile from Supabase (by auth_id)
  async loadProfile() {
    const authId = this.getUserId();
    if (!authId) return null;
    try {
      const res = await fetch(`/api/profile?auth_id=${authId}`);
      const data = await res.json();
      if (data && data.id && !data.error) return data;
    } catch(e) { console.log('Profile load:', e); }
    return null;
  },

  // Require login — redirect to auth page if not logged in
  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = 'auth.html';
      return false;
    }
    return true;
  },

  // Update nav UI across all pages
  updateNavUI() {
    const profileBtn = document.querySelector('.nav-profile-btn');
    const navCta = document.querySelector('.nav-cta');
    
    if (this.isLoggedIn()) {
      // Show user initial in profile button
      const name = this.getUserName();
      if (profileBtn) {
        profileBtn.textContent = name.charAt(0).toUpperCase();
        profileBtn.title = name;
      }
      // Change CTA to show logged-in state
      if (navCta && navCta.textContent.includes('Get Started')) {
        // keep as is — Get Started goes to chatbot
      }
    } else {
      if (profileBtn) {
        profileBtn.textContent = '👤';
        profileBtn.title = 'Login';
        profileBtn.onclick = () => { window.location.href = 'auth.html'; };
      }
    }
  }
};

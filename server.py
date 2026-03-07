#!/usr/bin/env python3
"""
Wellpal Local Server + Gemini API Proxy + Supabase Backend
-----------------------------------------------------------
Serves static files, proxies chat requests to Gemini API,
and proxies profile / chat-history CRUD to Supabase.

Usage:  python server.py
Open:   http://localhost:3000/wellpal-v5-updated%20(2).html
"""

import http.server
import socketserver
import os
import json
import urllib.request
import urllib.error
import urllib.parse

PORT = 3000
GEMINI_API_KEY = "AIzaSyAfqSvsKbdH1G74rIpyE9OF-kSHYT0u-1c"

# ── Supabase config ──
SUPABASE_URL = "https://mhcsydopmhgdxvpxllyu.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oY3N5ZG9wbWhnZHh2cHhsbHl1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg2NzgwNSwiZXhwIjoyMDg4NDQzODA1fQ.M_Br1E-0AgBBhnh4-W0_PihM8bbcH53Fy0y1RTxQ6yU"

SUPA_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# Primary model (confirmed working with this key)
MODEL = "gemini-2.5-flash"
FALLBACK_MODELS = ["gemini-2.5-flash"]  # retry same model on transient errors

SYSTEM_PROMPT = """You are Wellpal AI, a warm, knowledgeable health and wellness assistant. Help users with:
- Medicine guidance and drug interaction checks
- Personalised diet and nutrition planning
- Heart disease risk awareness and prevention
- Elderly health care tips
- General wellness, stress, sleep, hydration, and fitness

Rules:
- Warm, clear, supportive tone always.
- Use health emojis naturally.
- Use **bold** for key terms. Use line breaks for readability.
- Always remind users to consult a qualified doctor for personal decisions.
- IMPORTANT: Always give COMPLETE, FULL responses. Never cut off mid-sentence or mid-list.
- If the user asks for a multi-day plan (e.g. 7-day diet chart), provide ALL days in full detail in a single response.
- For diet plans, meal plans, or exercise routines, include every day completely — do not stop partway.
- Use structured formatting with headers, bullet points, and numbered lists for long responses.
- Be thorough and detailed — users rely on complete information."""


# ═══════════════════════════════════════
#  GEMINI API
# ═══════════════════════════════════════

def call_gemini(request_body):
    """Call Gemini API — uses gemini-2.5-flash on v1beta, with fallbacks.
    Supports multimodal input (text + images via inline_data)."""
    contents = request_body.get("contents", [])
    
    # Check if request contains images (for longer timeout)
    has_image = any(
        part.get("inline_data")
        for msg in contents
        for part in msg.get("parts", [])
    )
    timeout = 60 if has_image else 30
    
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.75},
    }

    models_to_try = [MODEL] + FALLBACK_MODELS
    last_error = ""

    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                if text:
                    print(f"  ✅ {model}")
                    return {"reply": text, "model": model}
                last_error = "Empty response from model"
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"  ⚠️ {model}: {e.code} - {body[:150]}")
            last_error = body
        except Exception as e:
            print(f"  ⚠️ {model}: {e}")
            last_error = str(e)

    return {"error": last_error or "All models failed"}


# ═══════════════════════════════════════
#  SUPABASE HELPERS
# ═══════════════════════════════════════

def supa_request(method, path, body=None, extra_headers=None):
    """Generic Supabase REST API call."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = dict(SUPA_HEADERS)
    if extra_headers:
        headers.update(extra_headers)

    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else []
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"  ⚠️ Supabase {method} {path}: {e.code} — {err_body[:200]}")
        return {"error": err_body, "status": e.code}
    except Exception as e:
        return {"error": str(e)}


def supa_auth(endpoint, body=None, method="POST", access_token=None):
    """Supabase Auth API call (GoTrue)."""
    url = f"{SUPABASE_URL}/auth/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
    }
    # Admin endpoints need service role key as Bearer token
    if endpoint.startswith("admin/"):
        headers["Authorization"] = f"Bearer {SUPABASE_KEY}"
    elif access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"  ⚠️ Auth {endpoint}: {e.code} — {err_body[:300]}")
        try:
            return {"error": json.loads(err_body).get("msg", err_body), "status": e.code}
        except Exception:
            return {"error": err_body, "status": e.code}
    except Exception as e:
        return {"error": str(e)}


# ═══════════════════════════════════════
#  REQUEST HANDLER
# ═══════════════════════════════════════

class WellpalHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def _read_body(self):
        content_len = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(content_len).decode("utf-8")) if content_len else {}

    # ── GET routes ──
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = dict(urllib.parse.parse_qsl(parsed.query))

        # GET /api/profile  — get by id or auth_id (auth_id required for security)
        if path == "/api/profile":
            pid = qs.get("id")
            auth_id = qs.get("auth_id")
            if pid:
                result = supa_request("GET", f"user_profiles?id=eq.{pid}&select=*")
            elif auth_id:
                result = supa_request("GET", f"user_profiles?auth_id=eq.{auth_id}&select=*")
            else:
                # No identifier — return empty (don't leak other users' data)
                self._send_json({"error": "not_logged_in", "message": "Please log in to view your profile"})
                return
            self._send_json(result[0] if isinstance(result, list) and result else result)
            return

        # GET /api/sessions  — list chat sessions (optionally by profile_id)
        if path == "/api/sessions":
            pid = qs.get("profile_id")
            if pid:
                result = supa_request("GET", f"chat_sessions?profile_id=eq.{pid}&select=*&order=updated_at.desc")
            else:
                result = supa_request("GET", "chat_sessions?select=*&order=updated_at.desc")
            self._send_json(result)
            return

        # GET /api/messages?session_id=xxx  — get messages for a session
        if path == "/api/messages":
            sid = qs.get("session_id")
            if not sid:
                self._send_json({"error": "session_id required"}, 400)
                return
            result = supa_request("GET", f"chat_messages?session_id=eq.{sid}&select=*&order=created_at.asc")
            self._send_json(result)
            return

        # GET /api/chat-history  — get all sessions with their messages for profile page
        if path == "/api/chat-history":
            pid = qs.get("profile_id")
            if pid:
                sessions = supa_request("GET", f"chat_sessions?profile_id=eq.{pid}&select=*&order=updated_at.desc&limit=20")
            else:
                sessions = supa_request("GET", "chat_sessions?select=*&order=updated_at.desc&limit=20")
            if isinstance(sessions, list):
                for s in sessions:
                    msgs = supa_request("GET", f"chat_messages?session_id=eq.{s['id']}&select=*&order=created_at.asc&limit=50")
                    s["messages"] = msgs if isinstance(msgs, list) else []
            self._send_json(sessions)
            return

        # Default: serve static files
        super().do_GET()

    # ── POST routes ──
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        # ── AUTH: Sign Up ──
        if path == "/api/auth/signup":
            body = self._read_body()
            email = body.get("email", "")
            password = body.get("password", "")
            name = body.get("name", "User")
            print(f"  📝 Signup request for: {email}")
            if not email or not password:
                self._send_json({"error": "Email and password required"}, 400)
                return

            # 1. Create auth user via Admin API (no email sent, no rate limit)
            admin_result = supa_auth("admin/users", {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"name": name}
            })
            print(f"  📝 Admin create response keys: {list(admin_result.keys())}")
            if "error" in admin_result:
                err_msg = admin_result["error"]
                # Friendlier message for duplicate
                if "already been registered" in str(err_msg).lower() or "already exists" in str(err_msg).lower():
                    err_msg = "An account with this email already exists. Please sign in."
                print(f"  ❌ Signup error: {err_msg}")
                self._send_json({"error": err_msg}, admin_result.get("status", 400))
                return

            # 2. Extract auth_id from admin response (returns user object directly)
            auth_id = admin_result.get("id")
            print(f"  📝 Auth ID: {auth_id}")

            # 3. Create user_profile linked to auth user
            if auth_id:
                profile_payload = {
                    "auth_id": auth_id,
                    "name": name,
                    "email": email,
                }
                for f in ["age", "gender", "location", "phone", "height", "weight", "blood_type", "allergies"]:
                    if f in body:
                        profile_payload[f] = body[f]
                prof_result = supa_request("POST", "user_profiles", profile_payload)
                print(f"  📝 Profile created: {type(prof_result)}")

            # 4. Auto-login: get a session token so user is immediately logged in
            login_result = supa_auth("token?grant_type=password", {
                "email": email,
                "password": password,
            })
            if "error" in login_result:
                # User was created but login failed — still return success
                print(f"  ⚠️ Auto-login failed: {login_result['error']}")
                self._send_json({"message": "Account created! Please sign in.", "needs_login": True}, 201)
                return

            print(f"  ✅ Signup + auto-login successful for {email}")
            self._send_json(login_result, 201)
            return

        # ── AUTH: Login ──
        if path == "/api/auth/login":
            body = self._read_body()
            auth_result = supa_auth("token?grant_type=password", {
                "email": body.get("email", ""),
                "password": body.get("password", ""),
            })
            if "error" in auth_result:
                self._send_json(auth_result, auth_result.get("status", 401))
                return
            # Auto-create profile if user doesn't have one yet
            user = auth_result.get("user", {})
            auth_id = user.get("id") if isinstance(user, dict) else None
            if auth_id:
                existing = supa_request("GET", f"user_profiles?auth_id=eq.{auth_id}&select=id")
                if isinstance(existing, list) and len(existing) == 0:
                    name = user.get("user_metadata", {}).get("name", "") or body.get("email", "").split("@")[0]
                    supa_request("POST", "user_profiles", {
                        "auth_id": auth_id,
                        "name": name,
                        "email": user.get("email", body.get("email", "")),
                    })
                    print(f"  📝 Auto-created profile for {name}")
            self._send_json(auth_result)
            return

        # ── AUTH: Get current user (by access token) ──
        if path == "/api/auth/user":
            body = self._read_body()
            token = body.get("access_token", "")
            if not token:
                self._send_json({"error": "access_token required"}, 400)
                return
            user = supa_auth("user", method="GET", access_token=token)
            if "error" in user:
                self._send_json(user, user.get("status", 401))
                return
            self._send_json(user)
            return

        # ── AUTH: Logout ──
        if path == "/api/auth/logout":
            body = self._read_body()
            token = body.get("access_token", "")
            if token:
                supa_auth("logout", method="POST", access_token=token)
            self._send_json({"ok": True})
            return

        # POST /api/chat  — Gemini AI proxy
        if path == "/api/chat":
            try:
                body = self._read_body()
                result = call_gemini(body)
                self._send_json(result)
            except Exception as e:
                print(f"  ❌ /api/chat error: {e}")
                self._send_json({"error": f"Server error: {str(e)}"}, 500)
            return

        # POST /api/profile  — create profile
        if path == "/api/profile":
            body = self._read_body()
            result = supa_request("POST", "user_profiles", body)
            data = result[0] if isinstance(result, list) and result else result
            self._send_json(data, 201)
            return

        # POST /api/sessions  — create chat session
        if path == "/api/sessions":
            body = self._read_body()
            result = supa_request("POST", "chat_sessions", body)
            data = result[0] if isinstance(result, list) and result else result
            self._send_json(data, 201)
            return

        # POST /api/messages  — save a chat message
        if path == "/api/messages":
            body = self._read_body()
            result = supa_request("POST", "chat_messages", body)
            data = result[0] if isinstance(result, list) and result else result
            self._send_json(data, 201)
            return

        # POST /api/messages/bulk  — save multiple messages at once
        if path == "/api/messages/bulk":
            body = self._read_body()  # expects a list
            result = supa_request("POST", "chat_messages", body)
            self._send_json(result, 201)
            return

        self.send_response(404)
        self.end_headers()

    # ── PATCH routes ──
    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = dict(urllib.parse.parse_qsl(parsed.query))

        # PATCH /api/profile?id=xxx  — update profile
        if path == "/api/profile":
            pid = qs.get("id")
            if not pid:
                self._send_json({"error": "id required"}, 400)
                return
            body = self._read_body()
            result = supa_request("PATCH", f"user_profiles?id=eq.{pid}", body)
            data = result[0] if isinstance(result, list) and result else result
            self._send_json(data)
            return

        # PATCH /api/sessions?id=xxx  — update session title
        if path == "/api/sessions":
            sid = qs.get("id")
            if not sid:
                self._send_json({"error": "id required"}, 400)
                return
            body = self._read_body()
            result = supa_request("PATCH", f"chat_sessions?id=eq.{sid}", body)
            data = result[0] if isinstance(result, list) and result else result
            self._send_json(data)
            return

        self.send_response(404)
        self.end_headers()

    # ── DELETE routes ──
    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = dict(urllib.parse.parse_qsl(parsed.query))

        # DELETE /api/sessions?id=xxx  — delete session + its messages (cascade)
        if path == "/api/sessions":
            sid = qs.get("id")
            if not sid:
                self._send_json({"error": "id required"}, 400)
                return
            result = supa_request("DELETE", f"chat_sessions?id=eq.{sid}")
            self._send_json({"ok": True})
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        print(f"  {self.address_string()} → {format % args}")


os.chdir(os.path.dirname(os.path.abspath(__file__)))

print("=" * 50)
print("  🌿 Wellpal Server + Gemini + Supabase")
print("=" * 50)
print(f"  Serving files from: {os.getcwd()}")
print(f"  Supabase:           {SUPABASE_URL}")
print(f"  Open in browser:    http://localhost:{PORT}")
print(f"  Press Ctrl+C to stop")
print("=" * 50)

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), WellpalHandler) as httpd:
    httpd.serve_forever()

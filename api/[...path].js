const SYSTEM_PROMPT = `You are Wellpal AI, a warm, knowledgeable health and wellness assistant. Help users with:
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
- Be thorough and detailed — users rely on complete information.`;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

function sendJson(res, status, data) {
  res.status(status).json(data);
}

function missingSupabaseConfig() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

async function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

async function supaRequest(method, path, body = null, extraHeaders = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetch(url, {
    method,
    headers: getSupabaseHeaders(extraHeaders),
    body: body === null ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = text ? null : [];
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    return { error: data, status: response.status };
  }

  return data;
}

async function supaAuth(endpoint, { method = "POST", body = null, accessToken = null } = {}) {
  const url = `${SUPABASE_URL}/auth/v1/${endpoint}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };

  if (endpoint.startsWith("admin/")) {
    headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  } else if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const errorMessage = data?.msg || data?.error_description || data?.error || text || "Auth request failed";
    return { error: errorMessage, status: response.status };
  }

  return data;
}

async function callGemini(body) {
  const contents = Array.isArray(body.contents) ? body.contents : [];
  const hasImage = contents.some((msg) => (msg.parts || []).some((part) => part.inline_data));

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { maxOutputTokens: 4096, temperature: 0.75 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(hasImage ? 60000 : 30000),
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || "Gemini API request failed";
    return { error: message, status: response.status };
  }

  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) {
    return { error: "Empty response from model", status: 502 };
  }

  return { reply, model: GEMINI_MODEL };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const pathname = (req.url || "").split("?")[0].replace(/^\/api/, "") || "/";
  const query = req.query || {};
  const needsSupabase = pathname !== "/chat";

  if (needsSupabase) {
    const missing = missingSupabaseConfig();
    if (missing.length > 0) {
      return sendJson(res, 500, {
        error: "Missing required environment variables",
        missing,
      });
    }
  }

  if (pathname === "/chat" && !GEMINI_API_KEY) {
    return sendJson(res, 500, {
      error: "Missing required environment variables",
      missing: ["GEMINI_API_KEY"],
    });
  }

  try {
    if (req.method === "GET" && pathname === "/profile") {
      const id = query.id;
      const authId = query.auth_id;

      if (id) {
        const result = await supaRequest("GET", `user_profiles?id=eq.${encodeURIComponent(id)}&select=*`);
        const data = Array.isArray(result) ? result[0] || {} : result;
        return sendJson(res, 200, data);
      }

      if (authId) {
        const result = await supaRequest("GET", `user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=*`);
        const data = Array.isArray(result) ? result[0] || {} : result;
        return sendJson(res, 200, data);
      }

      return sendJson(res, 200, { error: "not_logged_in", message: "Please log in to view your profile" });
    }

    if (req.method === "GET" && pathname === "/sessions") {
      const profileId = query.profile_id;
      const path = profileId
        ? `chat_sessions?profile_id=eq.${encodeURIComponent(profileId)}&select=*&order=updated_at.desc`
        : "chat_sessions?select=*&order=updated_at.desc";
      const result = await supaRequest("GET", path);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && pathname === "/messages") {
      const sessionId = query.session_id;
      if (!sessionId) return sendJson(res, 400, { error: "session_id required" });
      const result = await supaRequest(
        "GET",
        `chat_messages?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.asc`
      );
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && pathname === "/chat-history") {
      const profileId = query.profile_id;
      const sessionsPath = profileId
        ? `chat_sessions?profile_id=eq.${encodeURIComponent(profileId)}&select=*&order=updated_at.desc&limit=20`
        : "chat_sessions?select=*&order=updated_at.desc&limit=20";
      const sessions = await supaRequest("GET", sessionsPath);

      if (!Array.isArray(sessions)) return sendJson(res, 200, sessions);

      const withMessages = await Promise.all(
        sessions.map(async (session) => {
          const messages = await supaRequest(
            "GET",
            `chat_messages?session_id=eq.${encodeURIComponent(session.id)}&select=*&order=created_at.asc&limit=50`
          );
          return {
            ...session,
            messages: Array.isArray(messages) ? messages : [],
          };
        })
      );

      return sendJson(res, 200, withMessages);
    }

    if (req.method === "POST" && pathname === "/auth/signup") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      const name = String(body.name || "User").trim() || "User";

      if (!email || !password) {
        return sendJson(res, 400, { error: "Email and password required" });
      }

      const adminResult = await supaAuth("admin/users", {
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        },
      });

      if (adminResult.error) {
        const rawError = String(adminResult.error);
        const isDuplicate = /already been registered|already exists/i.test(rawError);
        return sendJson(res, adminResult.status || 400, {
          error: isDuplicate ? "An account with this email already exists. Please sign in." : rawError,
        });
      }

      const authId = adminResult.id;
      if (authId) {
        const profilePayload = { auth_id: authId, name, email };
        const optionalFields = ["age", "gender", "location", "phone", "height", "weight", "blood_type", "allergies"];
        optionalFields.forEach((field) => {
          if (body[field] !== undefined) profilePayload[field] = body[field];
        });
        await supaRequest("POST", "user_profiles", profilePayload);
      }

      const loginResult = await supaAuth("token?grant_type=password", {
        body: { email, password },
      });

      if (loginResult.error) {
        return sendJson(res, 201, {
          message: "Account created! Please sign in.",
          needs_login: true,
        });
      }

      return sendJson(res, 201, loginResult);
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim();
      const password = String(body.password || "");

      const authResult = await supaAuth("token?grant_type=password", {
        body: { email, password },
      });

      if (authResult.error) {
        return sendJson(res, authResult.status || 401, authResult);
      }

      const authId = authResult?.user?.id;
      if (authId) {
        const existing = await supaRequest("GET", `user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=id`);
        if (Array.isArray(existing) && existing.length === 0) {
          const fallbackName = email.includes("@") ? email.split("@")[0] : "User";
          const name = authResult?.user?.user_metadata?.name || fallbackName;
          await supaRequest("POST", "user_profiles", {
            auth_id: authId,
            name,
            email: authResult?.user?.email || email,
          });
        }
      }

      return sendJson(res, 200, authResult);
    }

    if (req.method === "POST" && pathname === "/auth/user") {
      const body = await parseBody(req);
      const token = String(body.access_token || "");
      if (!token) return sendJson(res, 400, { error: "access_token required" });

      const user = await supaAuth("user", { method: "GET", accessToken: token });
      if (user.error) return sendJson(res, user.status || 401, user);
      return sendJson(res, 200, user);
    }

    if (req.method === "POST" && pathname === "/auth/logout") {
      const body = await parseBody(req);
      const token = String(body.access_token || "");
      if (token) {
        await supaAuth("logout", { method: "POST", accessToken: token });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/chat") {
      const body = await parseBody(req);
      const result = await callGemini(body);
      if (result.error) return sendJson(res, result.status || 500, { error: result.error });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/profile") {
      const body = await parseBody(req);
      const result = await supaRequest("POST", "user_profiles", body);
      if (result?.error) return sendJson(res, result.status || 400, result);
      const data = Array.isArray(result) ? result[0] || {} : result;
      return sendJson(res, 201, data);
    }

    if (req.method === "POST" && pathname === "/sessions") {
      const body = await parseBody(req);
      const result = await supaRequest("POST", "chat_sessions", body);
      if (result?.error) return sendJson(res, result.status || 400, result);
      const data = Array.isArray(result) ? result[0] || {} : result;
      return sendJson(res, 201, data);
    }

    if (req.method === "POST" && pathname === "/messages") {
      const body = await parseBody(req);
      const result = await supaRequest("POST", "chat_messages", body);
      if (result?.error) return sendJson(res, result.status || 400, result);
      const data = Array.isArray(result) ? result[0] || {} : result;
      return sendJson(res, 201, data);
    }

    if (req.method === "POST" && pathname === "/messages/bulk") {
      const body = await parseBody(req);
      const result = await supaRequest("POST", "chat_messages", body);
      if (result?.error) return sendJson(res, result.status || 400, result);
      return sendJson(res, 201, result);
    }

    if (req.method === "PATCH" && pathname === "/profile") {
      const id = query.id;
      if (!id) return sendJson(res, 400, { error: "id required" });
      const body = await parseBody(req);
      const result = await supaRequest("PATCH", `user_profiles?id=eq.${encodeURIComponent(id)}`, body);
      if (result?.error) return sendJson(res, result.status || 400, result);
      const data = Array.isArray(result) ? result[0] || {} : result;
      return sendJson(res, 200, data);
    }

    if (req.method === "PATCH" && pathname === "/sessions") {
      const id = query.id;
      if (!id) return sendJson(res, 400, { error: "id required" });
      const body = await parseBody(req);
      const result = await supaRequest("PATCH", `chat_sessions?id=eq.${encodeURIComponent(id)}`, body);
      if (result?.error) return sendJson(res, result.status || 400, result);
      const data = Array.isArray(result) ? result[0] || {} : result;
      return sendJson(res, 200, data);
    }

    if (req.method === "DELETE" && pathname === "/sessions") {
      const id = query.id;
      if (!id) return sendJson(res, 400, { error: "id required" });
      const result = await supaRequest("DELETE", `chat_sessions?id=eq.${encodeURIComponent(id)}`);
      if (result?.error) return sendJson(res, result.status || 400, result);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, {
      error: "Server error",
      details: String(error?.message || error),
    });
  }
}

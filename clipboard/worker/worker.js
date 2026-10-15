/**
 * Shared Clipboard — Cloudflare Worker (API)
 *
 * Bindings (configure in the Cloudflare dashboard → Worker → Settings):
 *   CLIPBOARD        KV namespace binding (required)
 *   PASSWORD         Secret — the password you type on the website (required)
 *   ALLOWED_ORIGIN   Plain-text variable — your Pages URL, e.g.
 *                    https://my-clipboard.pages.dev (optional; defaults to "*")
 *
 * Routes:
 *   GET  /api/text   → { text, updated, version }
 *   PUT  /api/text   ← { text, baseVersion, force }  → { ok, updated, version }
 *
 * Every request must send:  Authorization: Bearer <password>
 */

const KEY = "clipboard";
const MAX_CHARS = 1_000_000; // ~1 MB of text is plenty for a clipboard

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/text") {
      return json({ error: "Not found" }, 404, cors);
    }

    if (!env.CLIPBOARD || !env.PASSWORD) {
      return json({ error: "Server not configured: missing KV binding or PASSWORD secret." }, 500, cors);
    }

    if (!(await isAuthorized(request, env.PASSWORD))) {
      // Small delay makes password guessing slower.
      await new Promise((r) => setTimeout(r, 1000));
      return json({ error: "Wrong password." }, 401, cors);
    }

    try {
      if (request.method === "GET") {
        const data = await readEntry(env);
        return json(data, 200, cors);
      }

      if (request.method === "PUT") {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body." }, 400, cors);
        }
        if (typeof body.text !== "string") {
          return json({ error: "Missing 'text'." }, 400, cors);
        }
        if (body.text.length > MAX_CHARS) {
          return json({ error: "Text too large (max 1,000,000 characters)." }, 413, cors);
        }

        // Overwrite protection: reject if someone else saved since this
        // device last loaded, unless the client explicitly forces it.
        const current = await readEntry(env);
        if (!body.force && current.version !== (body.baseVersion ?? 0)) {
          return json(
            { error: "conflict", message: "The text was changed on another device.", current },
            409,
            cors
          );
        }

        const entry = {
          text: body.text,
          updated: new Date().toISOString(),
          version: current.version + 1,
        };
        await env.CLIPBOARD.put(KEY, JSON.stringify(entry));
        return json({ ok: true, updated: entry.updated, version: entry.version }, 200, cors);
      }

      return json({ error: "Method not allowed" }, 405, cors);
    } catch (err) {
      return json({ error: "Server error: " + (err && err.message ? err.message : err) }, 500, cors);
    }
  },
};

async function readEntry(env) {
  const raw = await env.CLIPBOARD.get(KEY);
  if (!raw) return { text: "", updated: null, version: 0 };
  try {
    const d = JSON.parse(raw);
    return { text: d.text ?? "", updated: d.updated ?? null, version: d.version ?? 0 };
  } catch {
    return { text: raw, updated: null, version: 0 };
  }
}

async function isAuthorized(request, password) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Compare SHA-256 digests in constant time so timing doesn't leak the password.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(password)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && given.length > 0;
}

function corsHeaders(env) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

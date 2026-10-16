/**
 * Shared Clipboard — Cloudflare Worker (API) + Durable Object storage
 *
 * Why a Durable Object instead of KV: KV is eventually consistent (other
 * locations can read data up to ~60 s old) and has no atomic compare-and-swap,
 * so two devices saving close together could silently overwrite each other.
 * A single Durable Object processes requests one at a time with strongly
 * consistent storage, so "check version, then write" is atomic and every
 * device sees a save immediately. Durable Objects are on the Workers Free plan.
 *
 * The same Worker also serves the website (public/) as static assets, so the
 * page and API share one origin and no CORS is needed (or allowed).
 *
 * Bindings (see wrangler.toml):
 *   CLIP             Durable Object namespace → class Clipboard
 *   PASSWORD         Secret — the password you type on the website
 *
 * Routes:
 *   GET  /api/text   → { text, updated, version }
 *   PUT  /api/text   ← { text, baseVersion, force }  → { ok, updated, version }
 *                    → 409 { error: "conflict", current } if baseVersion is stale
 *
 * Every request must send:  Authorization: Bearer <password>
 */

import { DurableObject } from "cloudflare:workers";

const MAX_BYTES = 1_000_000; // 1 MB of UTF-8 text

// ---------- storage: one Durable Object instance holds the one entry ----------

export class Clipboard extends DurableObject {
  async read() {
    return (await this.ctx.storage.get("entry")) || { text: "", updated: null, version: 0 };
  }

  // Runs atomically: a Durable Object never interleaves other requests
  // between these storage operations (input/output gates).
  async write(text, baseVersion, force) {
    const current = await this.read();
    if (!force && current.version !== baseVersion) {
      return { conflict: true, current };
    }
    const entry = { text, updated: new Date().toISOString(), version: current.version + 1 };
    await this.ctx.storage.put("entry", entry);
    return { ok: true, updated: entry.updated, version: entry.version };
  }
}

// ---------- HTTP API ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/text") {
      return json({ error: "Not found" }, 404);
    }

    if (!env.CLIP || !env.PASSWORD) {
      return json({ error: "Server not configured: missing storage binding or PASSWORD secret." }, 500);
    }

    if (!(await isAuthorized(request, env.PASSWORD))) {
      // Small delay makes password guessing slower.
      await new Promise((r) => setTimeout(r, 1000));
      return json({ error: "Wrong password." }, 401);
    }

    const store = env.CLIP.get(env.CLIP.idFromName("main"));

    try {
      if (request.method === "GET") {
        return json(await store.read(), 200);
      }

      if (request.method === "PUT") {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body." }, 400);
        }
        if (typeof body.text !== "string") {
          return json({ error: "Missing 'text'." }, 400);
        }
        if (new TextEncoder().encode(body.text).length > MAX_BYTES) {
          return json({ error: "Text too large (max 1 MB)." }, 413);
        }
        const baseVersion = Number.isInteger(body.baseVersion) ? body.baseVersion : 0;

        const result = await store.write(body.text, baseVersion, body.force === true);
        if (result.conflict) {
          return json(
            { error: "conflict", message: "The text was changed on another device.", current: result.current },
            409
          );
        }
        return json(result, 200);
      }

      return json({ error: "Method not allowed" }, 405);
    } catch (err) {
      return json({ error: "Server error: " + (err && err.message ? err.message : err) }, 500);
    }
  },
};

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

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

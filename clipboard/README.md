# Shared Clipboard

A small, password-protected online clipboard. Paste text on one device, tap **Save**, and open the same URL on any other device to read and copy it. It works in both directions, and none of your devices has to stay on.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rayan65/Hello-World/tree/master/clipboard)

```
iPhone / Mac / any browser
        │  HTTPS (one URL: https://hello-world.<you>.workers.dev)
        ▼
Cloudflare Worker
   ├─ public/             website (index.html, style.css, script.js), served as static assets
   ├─ /api/text           checks the password
   └─ Durable Object      stores the one shared text entry, strongly consistent
```

Everything runs on Cloudflare's free plan. You don't need an API token, npm, a build step or your own computer.

## Deploying (from any browser, including iPhone)

1. Tap the **Deploy to Cloudflare** button above.
2. Log in to Cloudflare (or sign up for free), then connect GitHub when asked.
3. On the setup page:
   - Keep the defaults.
   - Type your website password into the **PASSWORD** field.
4. Tap **Create and deploy**.

The deploy flow:

- copies this folder into a new repository in your GitHub account,
- creates the Worker and its Durable Object storage,
- stores the password as an encrypted secret,
- deploys the Worker, and
- shows the public URL: `https://hello-world.<your-subdomain>.workers.dev`.

**Or use the dashboard** (this is how the current `hello-world` Worker is set up):

1. Go to **Workers & Pages → Create application → Import a repository**.
2. Choose `rayan65/Hello-World`.
3. Set **Branch** to `master`.
4. Set **Root directory** to `clipboard`.
5. Set **Project name** to `hello-world` (it must match `name` in `wrangler.toml`).
6. Tap **Deploy**.
7. Add the password in **Settings → Variables and Secrets**: **Add**, set **Type** to **Secret**, **Name** to `PASSWORD`, then **Deploy**.

### Updating later

Push changes to the connected repository. Workers Builds rebuilds and redeploys automatically. Your password and saved text are kept.

**Change the password:** go to **Worker → Settings → Variables and Secrets → `PASSWORD` → Edit**, then **Deploy**. Unlock again on each device afterwards.

## Files

| File | Purpose |
|---|---|
| `public/` | The website, plus `_headers` (security headers) |
| `worker/worker.js` | API and storage (Worker plus Durable Object) |
| `wrangler.toml` | Worker name, static assets folder, storage binding |
| `.dev.vars.example` | Declares the `PASSWORD` secret so the deploy page asks for it. It contains no real value. |
| `package.json` | The description of `PASSWORD` shown on the deploy page. There are no dependencies. |
| `test/live-test.mjs` | End-to-end test against the live site |

## Why a Durable Object instead of KV

KV has two problems for this app:

- **Stale reads:** other Cloudflare locations can serve the previous text for up to about 60 seconds after a save.
- **No atomic compare-and-swap:** the "check the version, then write" step could interleave between two saves.

Together, these meant two devices saving close together could both pass the conflict check, and one save would be lost silently.

A Durable Object fixes both:

- It handles requests one at a time with strongly consistent storage. The version check and the write are therefore atomic.
- Every device sees a save immediately.

Durable Objects with SQLite storage are included in the Workers Free plan.

## How overwrite protection works

Each save sends the version this device last loaded. If any other device saved in the meantime, the server rejects the save with a conflict, and the page asks:

- **OK:** overwrite the other device's text with yours.
- **Cancel:** keep the other device's text. Your text stays in the box, unsaved.

Other safeguards:

- **Refresh**, **Clear** and **Lock** ask before throwing away unsaved edits.
- Closing the tab with unsaved edits shows a warning.

## Using it

| Button | What it does |
|---|---|
| **Save** | Stores the text box contents, replacing the previous text. Shortcut: ⌘/Ctrl+S or ⌘/Ctrl+Enter. |
| **Copy** | Copies the text box contents to the device's clipboard. |
| **Refresh** | Loads the latest saved text. |
| **Clear** | Empties the text box only. Tap **Save** afterwards to clear the text on all devices. |
| **Lock** | Forgets the password on this device. |

- The text loads automatically when you open the page.
- It reloads automatically when you switch back to the tab or app, unless you have unsaved edits.
- On iPhone, use **Share → Add to Home Screen** so it opens like an app.

### History

Tap **History** below the buttons to see your last 10 saves, newest first, synced across all your devices. Each entry shows when it was saved, how long it is, and a preview with its formatting.

- **Copy** copies that entry's exact text, including tabs, line breaks and emoji.
- **Restore** puts it in the editor only. Nothing changes for your other devices until you tap **Save**, and that save goes through the normal conflict check.
- An 11th save removes the oldest entry.
- Saving empty text (**Clear** then **Save**) and re-saving unchanged text don't add entries.
- **Clear** never touches history.

History is stored in the same Durable Object as the clipboard, one key per entry, and is updated in the same transaction as each save. It needs the password like everything else (`GET /api/history`).

Text saved before history existed appears as the first history entry. No data is lost when upgrading.

## Security

- The password exists only as an encrypted Cloudflare secret. It isn't in git or in any website file.
- Every read and write requires the password. Wrong attempts get a `401` after a 1-second delay, which slows down guessing.
- Passwords are compared using hashes in constant time.
- Workers are served over HTTPS only.
- The website and the API share one origin. The API sends no CORS headers, so other websites can't call it from a browser.
- The page is served with a strict Content-Security-Policy and no-framing headers.
- After you unlock, the browser remembers your password so you don't retype it. Untick **Remember on this device** to keep it only until the tab closes. The clipboard text itself is never stored in the browser.
- Text is limited to 1 MB per save. Formatting and all Unicode text, including emoji, are preserved exactly.

## Testing the live site

```bash
CLIPBOARD_PASSWORD=... node test/live-test.mjs https://hello-world.<you>.workers.dev
```

The test checks:

- HTTPS, security headers and password rejection,
- that no CORS headers are sent,
- that 10 concurrent saves produce exactly 1 success,
- Unicode and formatting round-trips,
- syncing between two simulated devices (iPhone and Mac),
- both answers to the conflict prompt.

It overwrites the stored text and leaves the clipboard empty.

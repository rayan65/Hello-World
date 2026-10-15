# Shared Clipboard

A small, password-protected online clipboard. Paste text on one device, tap **Save**, and open the same URL on any other device to read and copy it. It works in both directions, and none of your devices has to stay on.

```
iPhone / Mac / any browser
        │  HTTPS
        ▼
Cloudflare Pages    (public/: index.html, style.css, script.js)
        │  HTTPS + password
        ▼
Cloudflare Worker   (worker/worker.js: checks the password)
        │
        ▼
Durable Object      (stores the one shared text entry, strongly consistent)
```

Everything runs on Cloudflare's free tier.

## Files

| File | Purpose |
|---|---|
| `public/` | The website: `index.html`, `style.css` and `script.js` |
| `worker/worker.js` | The API and storage (Worker plus Durable Object) |
| `worker/wrangler.toml` | Worker configuration: name, storage binding, migration |
| `deploy.sh` | Deploys or updates everything with one command |
| `test/live-test.mjs` | End-to-end test against the live site |

## Why a Durable Object instead of KV

The first version stored the text in Workers KV. KV has two problems for this app:

- **Stale reads:** other Cloudflare locations can serve the previous text for up to about 60 seconds after a save.
- **No atomic compare-and-swap:** the "check the version, then write" step could interleave between two saves.

Together, these meant two devices saving close together could both pass the conflict check, and one save would silently overwrite the other. That's a lost update.

A Durable Object fixes both problems:

- It handles one request at a time and its storage is strongly consistent. The version check and the write are therefore atomic.
- Every device sees a save immediately.

Durable Objects with SQLite storage are included in the Workers Free plan (100,000 requests per day, 5 GB of storage).

## How overwrite protection works

Each save sends the version this device last loaded. If any other device saved in the meantime, the server rejects the save with a conflict, and the page asks:

- **OK:** overwrite the other device's text with yours.
- **Cancel:** keep the other device's text. Your text stays in the box, unsaved.

Other safeguards:

- **Refresh**, **Clear** and **Lock** ask before throwing away unsaved edits.
- Closing the tab with unsaved edits shows a warning.

## Deploying and updating

You need a Cloudflare API token, created at **dash.cloudflare.com → My Profile → API Tokens → Create Token**:

1. Start from the **Edit Cloudflare Workers** template.
2. Add the permission **Account → Cloudflare Pages → Edit**.

Then run:

```bash
export CLOUDFLARE_API_TOKEN=...      # keep this out of git
export CLIPBOARD_PASSWORD=...        # the website password (first deploy, or to change it)
./clipboard/deploy.sh
```

The script does all of the following, and is safe to re-run for every update:

- Registers a `workers.dev` subdomain if your account has none.
- Creates the Pages project if it doesn't exist.
- Deploys the Worker and its Durable Object.
- Locks CORS to your Pages URL.
- Stores the password as an encrypted Worker secret.
- Fills in the Worker URL and uploads the website.

It prints both URLs when it finishes. If `CLIPBOARD_PASSWORD` is unset on the first deploy, it generates a password and prints it once.

The script uses `npx wrangler`, Cloudflare's official deploy tool, at deploy time only. The app itself has no dependencies.

**Change the password:** re-run the script with a new `CLIPBOARD_PASSWORD`. Then unlock again on each device.

**Test the live site:**

```bash
CLIPBOARD_PASSWORD=... node clipboard/test/live-test.mjs https://<pages-url> https://<worker-url>
```

The test checks HTTPS, password rejection, CORS, concurrent-save safety, Unicode round-trips, syncing between two simulated devices (iPhone and Mac), and the conflict prompt. It overwrites the stored text and leaves the clipboard empty.

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

## Security

- The password exists only as an encrypted Cloudflare secret. It isn't in git or in any website file.
- Every read and write requires the password. Wrong attempts get a `401` after a 1-second delay, which slows down guessing.
- Passwords are compared using hashes in constant time.
- Pages and Workers are served over HTTPS only.
- After you unlock, the browser remembers your password so you don't retype it. Untick **Remember on this device** to keep it only until the tab closes. The clipboard text itself is never stored in the browser.
- Text is limited to 1 MB per save. Formatting and all Unicode text, including emoji, are preserved exactly.

# Shared Clipboard

A small, password-protected online clipboard. Paste text on one device, tap **Save**, and open the same URL on any other device to read and copy it. It works in both directions, and none of your devices has to stay on.

```
iPhone / Mac / any browser
        │  HTTPS
        ▼
Cloudflare Pages   (index.html, style.css, script.js)
        │  HTTPS + password
        ▼
Cloudflare Worker  (worker.js: checks the password, reads and writes text)
        │
        ▼
Cloudflare KV      (stores one shared text entry)
```

Everything runs on Cloudflare's free tier. You don't need npm, a build step, GitHub or a database. Every step below happens in the Cloudflare website.

## Files

| File | Purpose |
|---|---|
| `public/index.html` | The page |
| `public/style.css` | Mobile-friendly styling, with automatic dark mode |
| `public/script.js` | Page logic. **You must edit one line (`API_URL`).** |
| `worker/worker.js` | The Cloudflare Worker API. You paste this into the Cloudflare editor. |

---

## Deployment (about 10 minutes, all in the browser)

Sign up or log in at <https://dash.cloudflare.com>. The free plan is enough.

> Cloudflare sometimes renames menu items. If a label below doesn't match exactly, look for the closest equivalent.

### Step 1: Create the KV storage

1. In the left sidebar, open **Storage & Databases → Workers KV** (on some dashboards it's **Workers & Pages → KV**).
2. Click **Create instance** (or **Create a namespace**).
3. Name it `clipboard` and click **Create**.

### Step 2: Create the Worker (the API)

1. Go to **Workers & Pages → Create → Workers**, then choose **Start with Hello World**.
2. Name it `shared-clipboard` and click **Deploy**.
3. Click **Edit code**. Delete everything in the editor, paste the full contents of `worker/worker.js`, and click **Deploy**.
4. Copy the Worker's URL from the Worker's overview page. It looks like
   `https://shared-clipboard.<your-subdomain>.workers.dev`.

### Step 3: Connect KV to the Worker

1. Open your Worker and go to **Bindings** (or **Settings → Bindings**).
2. Click **Add binding**, choose **KV namespace**, and fill in:
   - **Variable name:** `CLIPBOARD` (exactly this, in capitals)
   - **KV namespace:** `clipboard`
3. Save or deploy.

### Step 4: Set the password securely

1. In the Worker, go to **Settings → Variables and Secrets** and click **Add**.
2. Set **Type** to **Secret**, **Variable name** to `PASSWORD`, and **Value** to your password.
   Pick a long one, for example four or five random words.
3. Click **Deploy**.

Cloudflare stores the password encrypted. It never appears in your website files, and nobody can read it back from the dashboard.

### Step 5: Point the website at your Worker

Open `public/script.js` in any text editor (TextEdit works, in plain-text mode). Change the line near the top to your Worker URL from Step 2, with no trailing slash:

```js
const API_URL = "https://shared-clipboard.<your-subdomain>.workers.dev";
```

### Step 6: Deploy the website on Cloudflare Pages

1. Go to **Workers & Pages → Create → Pages**, then choose **Upload assets** (drag and drop).
2. Name the project, for example `my-clipboard`, and click **Create project**.
3. Drag the **`public` folder** (or the three files inside it) onto the upload area and click **Deploy site**.
4. Cloudflare shows your public HTTPS URL, for example **`https://my-clipboard.pages.dev`**. This is the URL you open on all your devices.

### Step 7 (recommended): Allow only your site to call the API

1. Go back to the Worker: **Settings → Variables and Secrets → Add**.
2. Set **Type** to **Text**, **Variable name** to `ALLOWED_ORIGIN`, and **Value** to your Pages URL, for example `https://my-clipboard.pages.dev` with no trailing slash.
3. Click **Deploy**.

This stops other websites from making browsers call your API. The password still protects the data either way.

### Step 8: Use it

1. On your iPhone, open the Pages URL in Safari, enter the password, and tap **Unlock**.
2. Optional: tap **Share → Add to Home Screen** so it opens like an app.
3. Do the same on your MacBook or any other device.

---

## How to use it

| Button | What it does |
|---|---|
| **Save** | Stores the text box contents on the server, replacing the previous text. Shortcut: ⌘/Ctrl+S or ⌘/Ctrl+Enter. |
| **Copy** | Copies the text box contents to the device's clipboard. |
| **Refresh** | Fetches the latest saved text from the server. It asks first if you have unsaved edits. |
| **Clear** | Empties the text box only. Tap **Save** afterwards to clear the text on all devices. |
| **Lock** | Forgets the password on this device. |

- The saved text loads automatically when you open the page.
- It also reloads automatically when you switch back to the tab or app, unless you have unsaved edits.
- **Last updated** shows when the text was last saved, from any device.
- "Unsaved changes" appears when the text box differs from what's saved.

### Delay when syncing to other devices

Cloudflare KV is *eventually consistent*. A save is stored right away, but other Cloudflare locations can keep serving the previous text **for up to about 60 seconds**. Most of the time the new text shows up within a few seconds. If another device still shows old text, wait a moment and tap **Refresh**.

### Protection against accidental overwrites

Each save carries a version number. If another device saved since this device last loaded or saved, the Worker rejects the save and the page asks:

- **OK:** overwrite the other device's text with yours.
- **Cancel:** don't save. Your text stays in the box so you can copy it before tapping Refresh.

Other safeguards:

- **Refresh** and **Clear** ask before throwing away edits.
- Closing the tab with unsaved edits shows a warning.

Because of KV's delay, this check is best effort. If two devices save within the same few seconds, the second save can still win.

---

## Security notes

- The password lives only in the Worker as an encrypted secret. It isn't in any website file.
- Every read and write requires the password. Wrong attempts get a `401` after a 1-second delay, which slows down guessing.
- Passwords are compared using hashes in constant time.
- Both Pages (`*.pages.dev`) and Workers (`*.workers.dev`) are served over HTTPS only.
- After you unlock, the browser remembers your password so you don't retype it. Untick **Remember on this device** to keep it only until you close the tab. Tap **Lock** to forget it right away. The clipboard text itself is never stored in the browser. It lives in KV.
- This is a personal tool. Use a strong password, and don't use it for highly sensitive secrets.

## Free-tier limits

These limits are far more than personal use needs:

- **Workers:** 100,000 requests per day.
- **KV:** 100,000 reads and 1,000 writes per day. Each **Save** is one write.
- **Text size:** up to 1,000,000 characters per save. Formatting, line breaks, tabs, emoji and other Unicode text are preserved exactly (UTF-8).

---

## Updating later

- **Website (HTML/CSS/JS):** go to **Workers & Pages → your Pages project → Create deployment** (or **Upload new version**), then upload the `public` folder again. The URL stays the same.
- **Worker code:** open the Worker, click **Edit code**, paste the new `worker.js`, and click **Deploy**.
- **Change password:** in the Worker, go to **Settings → Variables and Secrets**, edit `PASSWORD`, and deploy. Then unlock again on each device.
- **Custom domain (optional):** in your Pages project, go to **Custom domains**. If you use one, also update `ALLOWED_ORIGIN`.

## Troubleshooting

| Message | Fix |
|---|---|
| "Setup needed: set API_URL…" | You didn't edit `API_URL` in `script.js` (Step 5). Edit it and re-upload the site. |
| "Network error" | Check that `API_URL` is correct. Check that `ALLOWED_ORIGIN` exactly matches your Pages URL: `https`, no trailing slash. |
| "Server not configured" | The KV binding `CLIPBOARD` or the secret `PASSWORD` is missing or misspelled (Steps 3 and 4). |
| "Wrong password" | Re-enter the password. It is case-sensitive. |
| Other device shows old text | This is the KV delay. Wait up to about a minute, then tap **Refresh**. |

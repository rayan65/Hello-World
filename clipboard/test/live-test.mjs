// End-to-end test against the LIVE deployment.
// Usage: CLIPBOARD_PASSWORD=... node test/live-test.mjs <SITE_URL>
// Note: overwrites the stored clipboard text (it is emptied at the end).
import { createRequire } from "module";
import { execSync } from "child_process";

const SITE_URL = (process.argv[2] || "").replace(/\/$/, "");
const PW = process.env.CLIPBOARD_PASSWORD;
if (!SITE_URL || !PW) {
  console.error("Usage: CLIPBOARD_PASSWORD=... node test/live-test.mjs <SITE_URL>");
  process.exit(2);
}
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(execSync("npm root -g").toString().trim() + "/playwright"); }

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
};
const api = async (method, body, password = PW) => {
  const res = await fetch(SITE_URL + "/api/text", {
    method,
    headers: { Authorization: "Bearer " + password, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
};

// ---- API level ----
check("HTTPS", SITE_URL.startsWith("https://"));
if (SITE_URL.startsWith("https://")) {
  const plain = await fetch(SITE_URL.replace("https://", "http://"), { redirect: "manual" }).catch(() => null);
  check("HTTP redirects to HTTPS", !plain || [301, 302, 307, 308].includes(plain.status), plain && String(plain.status));
}
const page = await fetch(SITE_URL + "/");
check("Website loads", page.status === 200 && (await page.text()).includes("Shared Clipboard"));
check("Security headers on page", /default-src 'self'/.test(page.headers.get("content-security-policy") || ""));
check("No password rejected", (await api("GET", null, "")).status === 401);
check("Wrong password rejected", (await api("GET", null, "wrong-" + Date.now())).status === 401);
check("Wrong password cannot write", (await api("PUT", { text: "x", force: true }, "wrong")).status === 401);
const g0 = await api("GET");
check("Correct password reads", g0.status === 200, `version ${g0.data.version}`);
check("No cross-origin access (no CORS header)", !g0.headers.get("access-control-allow-origin"));

const base = g0.data.version;
const race = await Promise.all(Array.from({ length: 10 }, (_, i) => api("PUT", { text: "race " + i, baseVersion: base })));
const wins = race.filter((r) => r.status === 200).length, conflicts = race.filter((r) => r.status === 409).length;
check("Concurrent saves: exactly one wins, rest get 409", wins === 1 && conflicts === 9, `${wins} ok / ${conflicts} conflict`);

// ---- Browser level: two devices ----
const browser = await pw.chromium.launch();
const iphone = await browser.newContext({ ...pw.devices["iPhone 13"] });
const mac = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const A = await iphone.newPage(), B = await mac.newPage();
const dialogs = [];
for (const p of [A, B]) p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });

const unlock = async (p) => {
  await p.goto(SITE_URL, { waitUntil: "networkidle" });
  await p.fill("#password", PW);
  await p.click("button[type=submit]");
  await p.waitForSelector("#app:not(.hidden)");
  await p.waitForFunction(() => document.querySelector("#updated").textContent !== "—");
};
const waitMsg = (p) => p.waitForFunction(() => document.querySelector("#message").textContent.length > 0);

const wrongP = await mac.newPage();
await wrongP.goto(SITE_URL);
await wrongP.fill("#password", "definitely-wrong");
await wrongP.click("button[type=submit]");
await wrongP.waitForFunction(() => /Wrong password/.test(document.querySelector("#message").textContent), null, { timeout: 15000 });
check("Website rejects wrong password", !(await wrongP.isVisible("#app")));
await wrongP.close();

await unlock(A);
await unlock(B);

const unicode = "Héllo ✓ 👋🏽 家族 👨‍👩‍👧 Ñandú\n\tTabbed line\n    four spaces\n\nblank line above " + Date.now();
await A.fill("#text", unicode);
await A.click("#saveBtn");
await A.waitForFunction(() => /Saved/.test(document.querySelector("#message").textContent));
check("iPhone: save succeeds", true, await A.textContent("#updated"));

await B.click("#refreshBtn");
await B.waitForFunction((t) => document.querySelector("#text").value === t, unicode, { timeout: 10000 }).catch(() => {});
check("Mac sees iPhone's text immediately, byte-exact", (await B.inputValue("#text")) === unicode);

const reply = "Reply from Mac 🍎 " + Date.now();
await B.fill("#text", reply);
await B.click("#saveBtn");
await B.waitForFunction(() => /Saved/.test(document.querySelector("#message").textContent));
await A.reload({ waitUntil: "networkidle" });
await A.waitForFunction((t) => document.querySelector("#text").value === t, reply, { timeout: 10000 }).catch(() => {});
check("iPhone sees Mac's text on open (auto-load, remembered password)", (await A.inputValue("#text")) === reply);

// Overwrite protection: B is now stale (A saved after B loaded).
await A.fill("#text", "newer from iPhone");
await A.click("#saveBtn");
await A.waitForFunction(() => /Saved/.test(document.querySelector("#message").textContent));
await B.evaluate(() => (document.querySelector("#message").textContent = ""));
dialogs.length = 0;
B.removeAllListeners("dialog");
B.once("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); }); // choose "keep the other version"
await B.fill("#text", "stale edit from Mac");
await B.click("#saveBtn");
await waitMsg(B);
check("Stale save triggers conflict prompt", dialogs.some((m) => /changed on another device/.test(m)));
check("Declined conflict does NOT overwrite", (await api("GET")).data.text === "newer from iPhone");

B.once("dialog", (d) => d.accept()); // now choose overwrite
await B.evaluate(() => (document.querySelector("#message").textContent = ""));
await B.click("#saveBtn");
await B.waitForFunction(() => /Saved/.test(document.querySelector("#message").textContent));
check("Accepted conflict overwrites", (await api("GET")).data.text === "stale edit from Mac");

await A.screenshot({ path: "live-iphone.png" });
await browser.close();

// Leave the clipboard empty.
const cur = await api("GET");
await api("PUT", { text: "", baseVersion: cur.data.version });

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

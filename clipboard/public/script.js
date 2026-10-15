// ============================================================
// SETTING: put your Worker's URL here (no trailing slash).
// Example: "https://shared-clipboard.yourname.workers.dev"
// ============================================================
const API_URL = "https://shared-clipboard.YOUR-SUBDOMAIN.workers.dev";

// The password is never stored in this file. After you type it, it is kept
// in this browser only (so you don't have to retype it). The saved text
// itself lives on the server (Cloudflare Durable Object), not in the browser.
const PW_KEY = "clipboard-password";

const $ = (id) => document.getElementById(id);
const textEl = $("text");
const msgEl = $("message");
const updatedEl = $("updated");
const dirtyEl = $("dirty");
const buttons = ["saveBtn", "copyBtn", "refreshBtn", "clearBtn"].map($);

let version = 0;       // version of the text this device last loaded/saved
let savedText = "";    // text as last loaded/saved, to detect unsaved edits
let msgTimer = null;

// ---------- helpers ----------

function getPassword() {
  try {
    return sessionStorage.getItem(PW_KEY) || localStorage.getItem(PW_KEY) || "";
  } catch {
    return "";
  }
}

function setPassword(pw, remember) {
  try {
    sessionStorage.setItem(PW_KEY, pw);
    if (remember) localStorage.setItem(PW_KEY, pw);
    else localStorage.removeItem(PW_KEY);
  } catch { /* private mode: password just won't be remembered */ }
}

function forgetPassword() {
  try {
    sessionStorage.removeItem(PW_KEY);
    localStorage.removeItem(PW_KEY);
  } catch { /* ignore */ }
}

function showMessage(text, type = "ok", sticky = false) {
  clearTimeout(msgTimer);
  msgEl.textContent = text;
  msgEl.className = text ? type : "";
  if (text && !sticky) msgTimer = setTimeout(() => showMessage(""), 4000);
}

function setBusy(busy) {
  buttons.forEach((b) => (b.disabled = busy));
}

function isDirty() {
  return textEl.value !== savedText;
}

function updateDirty() {
  dirtyEl.classList.toggle("hidden", !isDirty());
}

function formatTime(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function showScreen(loggedIn) {
  $("loginForm").classList.toggle("hidden", loggedIn);
  $("app").classList.toggle("hidden", !loggedIn);
  $("logoutBtn").classList.toggle("hidden", !loggedIn);
}

async function api(method, body) {
  if (API_URL.includes("YOUR-SUBDOMAIN")) {
    throw new Error("Setup needed: set API_URL at the top of script.js to your Worker URL.");
  }
  let res;
  try {
    res = await fetch(API_URL + "/api/text", {
      method,
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + getPassword(),
        ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }

  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error */ }

  if (res.status === 401) {
    forgetPassword();
    showScreen(false);
    const err = new Error("Wrong password. Please unlock again.");
    err.status = 401;
    throw err;
  }
  if (res.status === 409) {
    const err = new Error(data.message || "Conflict");
    err.status = 409;
    err.current = data.current;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
  return data;
}

function applyServerData(data) {
  textEl.value = data.text || "";
  savedText = textEl.value;
  version = data.version || 0;
  updatedEl.textContent = formatTime(data.updated);
  updateDirty();
}

// ---------- actions ----------

async function load({ quiet = false } = {}) {
  setBusy(true);
  try {
    const data = await api("GET");
    applyServerData(data);
    if (!quiet) showMessage("Loaded latest text.");
    return true;
  } catch (e) {
    showMessage(e.message, "err", true);
    return false;
  } finally {
    setBusy(false);
  }
}

async function save(force = false) {
  setBusy(true);
  try {
    const text = textEl.value;
    const data = await api("PUT", { text, baseVersion: version, force });
    savedText = text;
    version = data.version;
    updatedEl.textContent = formatTime(data.updated);
    updateDirty();
    showMessage("Saved. Open or refresh on your other device to see it.");
  } catch (e) {
    if (e.status === 409) {
      const when = e.current && e.current.updated ? formatTime(e.current.updated) : "recently";
      const overwrite = confirm(
        "The text was changed on another device (" + when + ").\n\n" +
        "OK = overwrite it with your text\nCancel = keep it (your text stays in the box, not saved)"
      );
      setBusy(false);
      if (overwrite) return await save(true);
      showMessage("Not saved. Copy your text somewhere, then tap Refresh to see the other version.", "err", true);
    } else {
      showMessage(e.message, "err", true);
    }
  } finally {
    setBusy(false);
  }
}

async function copyText() {
  const text = textEl.value;
  if (!text) return showMessage("Nothing to copy.", "err");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers / non-secure contexts.
    textEl.focus();
    textEl.select();
    textEl.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand("copy");
    if (!ok) return showMessage("Couldn't copy automatically — the text is selected, copy it manually.", "err");
  }
  showMessage("Copied to clipboard.");
}

async function refresh() {
  if (isDirty() && !confirm("You have unsaved changes. Discard them and load the saved text?")) return;
  await load();
}

function clearText() {
  if (textEl.value && !confirm("Clear the text box?")) return;
  textEl.value = "";
  updateDirty();
  textEl.focus();
  showMessage("Cleared. Tap Save to clear it on all devices too.");
}

// ---------- wiring ----------

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("password").value;
  if (!pw) return;
  setPassword(pw, $("remember").checked);
  $("password").value = "";
  showScreen(true);
  await load({ quiet: true });
});

$("logoutBtn").addEventListener("click", () => {
  if (isDirty() && !confirm("You have unsaved changes. Lock anyway?")) return;
  forgetPassword();
  textEl.value = "";
  savedText = "";
  version = 0;
  updatedEl.textContent = "—";
  updateDirty();
  showScreen(false);
  showMessage("Locked.");
});

$("saveBtn").addEventListener("click", () => save());
$("copyBtn").addEventListener("click", copyText);
$("refreshBtn").addEventListener("click", refresh);
$("clearBtn").addEventListener("click", clearText);
textEl.addEventListener("input", updateDirty);

// Ctrl/Cmd + S or Ctrl/Cmd + Enter saves.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "Enter")) {
    e.preventDefault();
    if (!$("app").classList.contains("hidden")) save();
  }
});

// When you come back to this tab/app, fetch the latest text automatically
// (only if you have no unsaved edits, so nothing is ever lost).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && getPassword() && !isDirty()) {
    load({ quiet: true });
  }
});

window.addEventListener("beforeunload", (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
});

// Start: auto-load if we already know the password.
if (getPassword()) {
  showScreen(true);
  load({ quiet: true });
} else {
  showScreen(false);
  $("password").focus();
}

// The API is served by the same Worker as this page, so it uses a relative URL.
const API_URL = "/api/text";

// The password is never stored in this file. After you type it, it is kept
// in this browser only (so you don't have to retype it). The saved text
// itself lives on the server (Cloudflare Durable Object), not in the browser.
const PW_KEY = "clipboard-password";

const $ = (id) => document.getElementById(id);
const textEl = $("text");
const msgEl = $("message");
const updatedEl = $("updated");
const dirtyEl = $("dirty");
const historyEl = $("history");
const historyListEl = $("historyList");
const buttons = ["saveBtn", "copyBtn", "refreshBtn", "clearBtn"].map($);

let version = 0;       // version of the text this device last loaded/saved
let savedText = "";    // text as last loaded/saved, to detect unsaved edits
let msgTimer = null;
let historyEntries = []; // last loaded history, newest first

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
  historyEl.classList.toggle("hidden", !loggedIn);
}

async function api(method, body, url = API_URL) {
  let res;
  try {
    res = await fetch(url, {
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
    refreshHistoryIfOpen();
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
    refreshHistoryIfOpen();
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

// ---------- history ----------

async function loadHistory() {
  try {
    const data = await api("GET", null, "/api/history");
    historyEntries = data.entries || [];
    renderHistory();
  } catch (e) {
    showMessage(e.message, "err", true);
  }
}

function refreshHistoryIfOpen() {
  if (historyEl.open) loadHistory();
}

// Text areas turn "\r\n" into "\n" (HTML standard), so compare editor text
// with stored text after normalising line endings the same way.
const sameText = (a, b) => a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");

// Built with textContent only, so saved text is never interpreted as HTML.
function renderHistory() {
  historyListEl.replaceChildren();
  $("historyCount").textContent = historyEntries.length ? "(" + historyEntries.length + ")" : "";
  $("historyEmpty").classList.toggle("hidden", historyEntries.length > 0);

  historyEntries.forEach((entry, i) => {
    const li = document.createElement("li");

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = formatTime(entry.updated) + " · " + entry.text.length.toLocaleString() + " chars";
    if (i === 0 && sameText(entry.text, savedText)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Current";
      meta.append(" ", badge);
    }

    const preview = document.createElement("div");
    preview.className = "history-preview";
    preview.textContent = entry.text.slice(0, 500);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    for (const [action, label] of [["copy", "Copy"], ["restore", "Restore"]]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.dataset.action = action;
      btn.dataset.index = i;
      actions.append(btn);
    }

    li.append(meta, preview, actions);
    historyListEl.append(li);
  });
}

async function copyHistoryEntry(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers: copy from a temporary off-screen text area.
    const tmp = document.createElement("textarea");
    tmp.value = text;
    tmp.setAttribute("readonly", "");
    tmp.className = "offscreen";
    document.body.append(tmp);
    tmp.select();
    tmp.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand("copy");
    tmp.remove();
    if (!ok) return showMessage("Couldn't copy automatically. Restore it, then copy from the editor.", "err");
  }
  showMessage("Copied to clipboard.");
}

// Puts an old entry in the editor only. Nothing is saved until you tap Save.
function restoreHistoryEntry(text) {
  if (isDirty() && !sameText(textEl.value, text) &&
      !confirm("Replace the unsaved text in the editor with this history entry?")) return;
  textEl.value = text;
  updateDirty();
  textEl.scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage(isDirty()
    ? "Restored to the editor (not saved). Tap Save to make it the current clipboard."
    : "This entry is already the current clipboard.");
}

// ---------- wiring ----------

historyEl.addEventListener("toggle", () => {
  if (historyEl.open) loadHistory();
});

historyListEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const entry = historyEntries[Number(btn.dataset.index)];
  if (!entry) return;
  if (btn.dataset.action === "copy") copyHistoryEntry(entry.text);
  else restoreHistoryEntry(entry.text);
});

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
  historyEntries = [];
  renderHistory();
  historyEl.open = false;
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

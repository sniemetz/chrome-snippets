import { createStore } from "../lib/store.js";
import { openPalette } from "../lib/overlay.js";
import { handleMessage } from "../lib/messages.js";
import { originPattern, isPermissionError } from "../lib/paste-target.js";
import { centeredPosition } from "../lib/position.js";
import { createSyncState, INTERVALS } from "../lib/sync-state.js";
import { createFolder } from "../lib/folder.js";
import { createDropbox } from "../lib/dropbox.js";
import { createDropboxAuth, makePkce, buildAuthUrl } from "../lib/dropbox-auth.js";
import { createPending } from "../lib/dropbox-pending.js";
import { DROPBOX_APP_KEY } from "../lib/dropbox-config.js";
import { runSync } from "../lib/sync-engine.js";
import { getHandle, deleteHandle, promotePendingHandle } from "../popup/handle-store.js";

const store = createStore(chrome.storage.local);
const syncState = createSyncState(chrome.storage.local);
const MANAGER_URL = "popup/popup.html?view=window";
// Outer window size = 600 x 445 content plus window chrome (adjust after manual check).
const WIN = { width: 616, height: 490 };

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "paste", title: "Paste snippet", contexts: ["editable"] });
    // Only inside nested iframes: the top page is already covered by activeTab.
    chrome.contextMenus.create({ id: "allow", title: "Allow Snippets on this site", contexts: ["frame"] });
    chrome.contextMenus.create({ id: "add", title: "Add as snippet", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "open", title: "Open Snippets", contexts: ["all"] });
  });
});

// Short visible feedback on the toolbar icon (no popup is open when a menu item is clicked).
function flashBadge(text, title) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: text === "OK" ? "#166534" : "#b91c1c" });
  if (title) chrome.action.setTitle({ title });
  setTimeout(() => {
    chrome.action.setTitle({ title: "Snippets" });
    syncBadge();
  }, 3000);
}

// ---------- folder sync (see docs/superpowers/specs/2026-11-18-folder-sync-design.md) ----------
const SYNC_ALARM = "sync";
const DEBOUNCE_MS = 2000;
let chain = Promise.resolve();
let plainQueued = false;
let debounceTimer;

// "!" while sync needs the user (permission lost or a decision pending); otherwise empty.
async function syncBadge() {
  const { linked, status } = await syncState.get();
  const attention = linked && (status === "paused" || status === "needs-decision" || status === "error");
  chrome.action.setBadgeText({ text: attention ? "!" : "" });
  if (attention) chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
}

const dropboxAuth = () => createDropboxAuth({ fetch: (...a) => fetch(...a), area: chrome.storage.local, appKey: DROPBOX_APP_KEY });
const dropboxAdapter = () => createDropbox({ fetch: (...a) => fetch(...a), auth: dropboxAuth() });

const dropboxPending = () => createPending({ area: chrome.storage.local });

// Step 1 of the code-paste sign-in: PKCE verifier is persisted (the worker may be killed before the user pastes).
async function dropboxBegin(mode) {
  if (!DROPBOX_APP_KEY) throw new Error("Dropbox app key not configured");
  const { verifier, challenge } = await makePkce();
  await dropboxPending().begin(verifier, mode === "signin" ? "signin" : "link");
  return buildAuthUrl({ appKey: DROPBOX_APP_KEY, challenge });
}

// Step 2: exchange the pasted code; stores tokens only on success. The pending verifier is dropped once Dropbox
// answered (success or refusal); on a network failure it is kept so the user can press Connect again.
async function dropboxSignIn(rawCode) {
  if (!DROPBOX_APP_KEY) throw new Error("Dropbox app key not configured");
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!code) throw new Error("Paste the code from Dropbox");
  const pending = dropboxPending();
  const p = await pending.get();
  if (!p) throw new Error("Start the Dropbox sign-in again");
  try {
    await dropboxAuth().signIn(code, p.verifier);
  } catch (err) {
    if (!err?.network) await pending.clear();
    throw err;
  }
  await pending.clear();
}

async function doSync(opts) {
  try {
    const st = await syncState.get();
    if (!st.linked) return;
    try {
      if (st.backend === "dropbox") {
        await runSync({ store, folder: dropboxAdapter(), state: syncState, ...opts });
      } else {
        const dir = await getHandle();
        if (!dir) {
          await syncState.set({ status: "error", message: "Folder handle is missing. Choose the folder again." });
        } else {
          await runSync({ store, folder: createFolder(dir), state: syncState, ...opts });
        }
      }
    } catch (err) {
      console.warn("Sync failed:", err);
      await syncState.set({ status: "error", message: String(err?.message ?? err) });
    }
    await syncBadge();
  } catch (err) {
    console.warn("Sync bookkeeping failed:", err);
  }
}

// Everything that touches sync state or the folder runs here, one task at a time. A failing task never
// stops later ones.
function exclusive(task) {
  const run = chain.then(task);
  chain = run.catch(() => {});
  return run;
}

// Several plain triggers waiting for the same slot collapse into one run.
function enqueue(opts = {}) {
  const plain = Object.keys(opts).length === 0;
  if (plain) {
    if (plainQueued) return chain;
    plainQueued = true;
  }
  return exclusive(() => {
    if (plain) plainQueued = false;
    return doSync(opts);
  });
}

async function ensureAlarm({ force = false } = {}) {
  const { linked, intervalMin } = await syncState.get();
  if (!linked) { await chrome.alarms.clear(SYNC_ALARM); return; }
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (force || !existing || existing.periodInMinutes !== intervalMin) {
    await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: intervalMin });
  }
}

async function handleSyncMessage(msg) {
  switch (msg.type) {
    case "sync-now":
      await enqueue();
      return { ok: true };
    case "sync-decide":
      if (msg.choice === "folder" || msg.choice === "local") await enqueue({ resolve: msg.choice });
      return { ok: true };
    case "sync-set-interval": {
      if (!INTERVALS.some((i) => i.min === msg.min)) return { ok: false };
      await syncState.set({ intervalMin: msg.min });
      await ensureAlarm({ force: true });
      return { ok: true };
    }
    case "sync-link":
      return exclusive(async () => {
        const dir = await promotePendingHandle(); // switch folder and state together, inside the queue
        if (!dir) return { ok: false };
        await syncState.clear();
        await syncState.set({ linked: true, folderName: dir.name });
        // Folder link made: drop any Dropbox tokens (revoke never throws). A failed link returned above.
        const auth = dropboxAuth();
        if (await auth.hasLink() || await auth.isInvalid()) { await auth.revoke(); await auth.clear(); }
        await ensureAlarm({ force: true });
        await doSync({ firstLink: true });
        return { ok: true };
      });
    case "sync-dropbox-begin":
      try {
        return { ok: true, url: await dropboxBegin(msg.mode) };
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    case "sync-dropbox-pending": {
      const p = await dropboxPending().get();
      return { ok: true, mode: p ? p.mode : null };
    }
    case "sync-dropbox-cancel":
      await dropboxPending().clear();
      return { ok: true };
    case "sync-link-dropbox":
      return exclusive(async () => {
        try {
          await dropboxSignIn(msg.code); // sign in first: a failure leaves the existing link untouched
        } catch (err) {
          return { ok: false, error: String(err?.message ?? err), retry: err?.network === true };
        }
        const prior = await syncState.get();
        const priorDropbox = prior.linked && prior.backend === "dropbox";
        try {
          const account = await dropboxAdapter().accountName();
          await syncState.clear();
          await syncState.set({ linked: true, backend: "dropbox", account, folderName: "" });
          await ensureAlarm({ force: true });
          await doSync({ firstLink: true });
          return { ok: true };
        } catch (err) {
          // Link not made: drop the tokens just stored. An existing Dropbox link is paused, not kept on unverified tokens.
          await dropboxAuth().clear();
          if (priorDropbox) await syncState.set({ status: "paused", message: dropboxAdapter().pausedMessage });
          return { ok: false, error: String(err?.message ?? err) };
        }
      });
    case "sync-signin-dropbox":
      return exclusive(async () => {
        const st = await syncState.get();
        if (!(st.linked && st.backend === "dropbox")) return { ok: false, error: "Not linked to Dropbox" };
        try {
          await dropboxSignIn(msg.code);
        } catch (err) {
          return { ok: false, error: String(err?.message ?? err), retry: err?.network === true };
        }
        // Refuse a different account (or an unverifiable one): syncing would delete local snippets.
        let account = null;
        try { account = await dropboxAdapter().accountName(); } catch { /* treated as unverified */ }
        if (account === null || account !== st.account) {
          await dropboxAuth().clear();
          await syncState.set({ status: "paused", message: dropboxAdapter().pausedMessage });
          await syncBadge();
          return { ok: false, error: account === null
            ? "Could not verify the Dropbox account. Try again, or unlink first."
            : "Signed in as a different Dropbox account. Unlink first to switch accounts." };
        }
        await syncState.set({ status: "ok", message: "" });
        await syncBadge();
        enqueue();
        return { ok: true };
      });
    case "sync-unlink":
      return exclusive(async () => {
        const { backend } = await syncState.get();
        await dropboxPending().clear();
        if (backend === "dropbox") {
          const auth = dropboxAuth();
          await auth.revoke();
          await auth.clear();
        }
        await syncState.clear();
        await deleteHandle();
        await chrome.alarms.clear(SYNC_ALARM);
        await syncBadge();
        return { ok: true };
      });
    default:
      return { ok: false };
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!Object.keys(changes).some((k) => k === "meta" || k.startsWith("c:"))) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => enqueue(), DEBOUNCE_MS);
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === SYNC_ALARM) enqueue(); });
chrome.idle.onStateChanged.addListener((state) => { if (state === "active") enqueue(); });
chrome.runtime.onStartup.addListener(async () => { await ensureAlarm(); await syncBadge(); enqueue(); });
ensureAlarm();

// Opens the palette in the clicked frame. A cross-origin frame (e.g. an iframe inside a wrapper
// page) is refused without host permission: fall back to the top page in copy-only mode.
async function injectPalette(tabId, frameId) {
  const metas = await store.listMeta();
  const inject = (id, options) =>
    chrome.scripting.executeScript({ target: { tabId, frameIds: [id] }, func: openPalette, args: [metas, options] });
  try {
    await inject(frameId, {});
    return;
  } catch (err) {
    console.warn("Snippet palette unavailable in this frame:", err?.message ?? err);
    if (frameId === 0 || !isPermissionError(err)) {
      flashBadge("!", "Snippets unavailable on this page");
      return;
    }
  }
  try {
    await inject(0, { copyOnly: true });
  } catch (err) {
    console.warn("Snippet palette unavailable on this page:", err?.message ?? err);
    flashBadge("!", "Snippets unavailable on this page");
  }
}

// Opt-in: ask Chrome for host access to the origin of the clicked frame.
async function allowSite(info) {
  const pattern = originPattern(info.frameUrl || info.pageUrl);
  if (!pattern) {
    flashBadge("!", "Snippets cannot be allowed on this page");
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    flashBadge(granted ? "OK" : "!", granted ? `Snippets allowed on ${pattern}` : "Permission not granted");
  } catch (err) {
    console.warn("Permission request failed:", err?.message ?? err);
    flashBadge("!", "Permission request failed");
  }
}

async function openManager(panel) {
  // Hint for the manager: open straight on this panel (picked up at boot or via storage.onChanged).
  if (panel === "sync") await chrome.storage.session.set({ openPanel: "sync" });
  const { windowId } = await chrome.storage.session.get("windowId");
  if (windowId !== undefined) {
    try {
      await chrome.windows.update(windowId, { focused: true });
      return;
    } catch {
      // window is gone; fall through and create a new one
    }
  }
  let parent;
  try {
    parent = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    parent = undefined; // let Chrome place the window
  }
  const win = await chrome.windows.create({ type: "popup", url: MANAGER_URL, ...WIN, ...centeredPosition(parent, WIN) });
  await chrome.storage.session.set({ windowId: win.id });
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { windowId } = await chrome.storage.session.get("windowId");
  if (windowId === id) await chrome.storage.session.remove("windowId");
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "paste" && tab?.id !== undefined) {
    await injectPalette(tab.id, info.frameId ?? 0);
  } else if (info.menuItemId === "allow") {
    await allowSite(info);
  } else if (info.menuItemId === "add") {
    // Set the selection first: an already-open manager picks it up via storage.onChanged.
    await chrome.storage.session.set({ pendingNew: { content: info.selectionText ?? "" } });
    await openManager();
  } else if (info.menuItemId === "open") {
    await openManager();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-palette") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) await injectPalette(tab.id, 0);
});

// Palette (injected into pages) asks for search results and for one snippet body at a time.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (typeof msg?.type === "string" && msg.type.startsWith("sync-")) {
    // Sync control comes from extension pages only (the palette runs inside web pages).
    if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    handleSyncMessage(msg).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "open-manager") {
    openManager(msg.panel).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  handleMessage(store, msg).then(sendResponse, () => sendResponse(undefined));
  return true;
});

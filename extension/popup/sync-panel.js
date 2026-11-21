import { INTERVALS, createSyncState, needsAttention } from "../lib/sync-state.js";
import { pausedView, pausedStatusText, linkedView, unlinkText } from "../lib/sync-view.js";

// Sync panel (manager window). Reads the persisted sync state and re-renders when it changes.
// getHandle/putHandle/deleteHandle: directory handle store; send(msg): runtime message to the service worker.
// compact: toolbar-popup gate. Shows only what the user must do (re-allow / decision), no Cancel,
// and calls onResolved() as soon as sync no longer needs attention.
export function mountSyncPanel(root, { getHandle, putHandle, send, onStatus, state = createSyncState(), compact = false, onResolved }) {
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const btn = (label, onclick, props = {}) => el("button", { type: "button", textContent: label, onclick, ...props });
  const row = (...kids) => el("div", { className: "syncrow" }, ...kids);
  let confirmUnlink = false;
  let decisionDismissed = false;
  let signingIn = false; // a Dropbox sign-in is pending: sign-in buttons stay disabled

  async function pick() {
    let dir;
    try {
      dir = await showDirectoryPicker({ mode: "readwrite", id: "snippet-sync" });
    } catch (err) {
      if (err?.name !== "AbortError") onStatus(`Could not open the folder: ${err?.message ?? err}`, true);
      return;
    }
    await putHandle(dir);
    decisionDismissed = false;
    await send({ type: "sync-link" });
  }

  async function reallow() {
    try {
      const dir = await getHandle();
      const granted = dir && (await dir.requestPermission({ mode: "readwrite" })) === "granted";
      if (!granted) { onStatus("Permission not granted", true); return; }
      await send({ type: "sync-now" });
    } catch (err) {
      onStatus(`Could not re-allow the folder: ${err?.message ?? err}`, true);
    }
  }

  // Dropbox sign-in (link when unlinked, sign in again when paused). Failures show the returned error.
  async function dropbox(type) {
    if (signingIn) return;
    signingIn = true;
    render();
    try {
      const res = await send({ type });
      if (res && res.ok === false) { onStatus(res.error || "Dropbox sign-in failed", true); return; }
      decisionDismissed = false;
    } catch (err) {
      onStatus(`Dropbox sign-in failed: ${err?.message ?? err}`, true);
    } finally {
      signingIn = false;
      render();
    }
  }

  function statusText(st) {
    if (st.status === "error") return st.message || "Sync failed";
    if (st.status === "needs-decision") return "Sync stopped: waiting for your decision";
    if (st.status === "paused") return pausedStatusText(st);
    if (!st.lastSync) return "Not synced yet";
    const time = new Date(st.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Synced ${time} - ${Object.keys(st.synced).length} snippets`;
  }

  function banners(st, withCancel) {
    if (st.status === "paused") {
      const pv = pausedView(st);
      root.append(row(el("span", { className: "err", textContent: pv.text }), btn(pv.actionLabel, pv.action === "signin" ? () => dropbox("sync-signin-dropbox") : reallow, { className: "primary", disabled: pv.action === "signin" && signingIn })));
    }
    if (st.status === "needs-decision" && withCancel && decisionDismissed) {
      root.append(row(el("span", { className: "err", textContent: "Sync is stopped until you decide." }), btn("Decide...", () => { decisionDismissed = false; render(); })));
    }
    if (st.status === "needs-decision" && st.decision && !(withCancel && decisionDismissed)) {
      const n = st.decision.conflicts;
      root.append(
        el("p", { className: "err", textContent: `${n} snippet${n === 1 ? "" : "s"} conflict (deleted on one side or edited on both). Choose which side wins for these. Everything else is merged.` }),
        row(
          btn("Folder wins", () => send({ type: "sync-decide", choice: "folder" })),
          btn("This device wins", () => send({ type: "sync-decide", choice: "local" })),
          ...(withCancel ? [btn("Cancel", () => { send({ type: "sync-decide", choice: "cancel" }); decisionDismissed = true; render(); })] : []),
        ),
      );
    }
  }

  async function render() {
    const st = await state.get();
    if (compact && !needsAttention(st)) { onResolved?.(); return; }
    root.replaceChildren(el("h2", { textContent: "Sync" }));
    if (compact) { banners(st, false); return; }
    if (!st.linked) {
      root.append(
        el("p", { className: "placeholder", textContent: "Sync your snippets between devices with Dropbox, or with a folder that your own tool keeps in sync. For a folder, choose \"Allow on every visit\" when Chrome asks." }),
        row(btn("Sign in to Dropbox...", () => dropbox("sync-link-dropbox"), { className: "primary", disabled: signingIn }), btn("Choose local folder...", pick)),
        el("p", { className: "muted", textContent: `Extension ID: ${chrome.runtime.id}` }),
        el("p", { className: "muted", textContent: `Add ${chrome.identity.getRedirectURL()} as a redirect URI in the Dropbox app` }),
      );
      return;
    }
    banners(st, true);
    const lv = linkedView(st);
    root.append(row(el("span", { textContent: lv.label }), ...(lv.showChangeFolder ? [btn("Change folder...", pick)] : [])));
    root.append(row(el("span", { textContent: statusText(st) }), btn("Sync now", () => send({ type: "sync-now" }))));
    if (st.message && st.status !== "error" && st.status !== "paused") root.append(el("p", { className: "muted", textContent: st.message }));
    if (st.summary) root.append(el("p", { className: "muted", textContent: `First sync: ${st.summary}` }));
    const sel = el("select", { ariaLabel: "Check every" });
    for (const i of INTERVALS) sel.append(new Option(i.label, String(i.min), false, i.min === st.intervalMin));
    sel.onchange = () => send({ type: "sync-set-interval", min: Number(sel.value) });
    root.append(row(el("label", {}, "Check every: ", sel)));
    if (confirmUnlink) {
      root.append(
        el("p", { className: "err", textContent: unlinkText(st) }),
        row(btn("Cancel", () => { confirmUnlink = false; render(); }), btn("Unlink", async () => { confirmUnlink = false; await send({ type: "sync-unlink" }); })),
      );
    } else {
      root.append(row(btn("Unlink", () => { confirmUnlink = true; render(); })));
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.sync) return;
    if (changes.sync.newValue?.status !== "needs-decision") decisionDismissed = false;
    if (!root.hidden) render();
  });
  return { render };
}

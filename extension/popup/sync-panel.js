import { besidePosition } from "../lib/position.js";
import { INTERVALS, createSyncState, needsAttention } from "../lib/sync-state.js";
import { syncBusy, syncButtonView, unlinkDisabled, pausedView, pausedStatusText, linkedView, unlinkText, signinInGate, codeCheck, codeApplies } from "../lib/sync-view.js";

// Sync panel (manager window). Reads the persisted sync state and re-renders when it changes.
// send(msg): runtime message to the service worker.
// compact: toolbar-popup gate. Shows only what the user must do (sign in / decision), no Cancel,
// and calls onResolved() as soon as sync no longer needs attention.
export function mountSyncPanel(root, { send, onStatus, state = createSyncState(), compact = false, onResolved }) {
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
  let codeEntry = null; // "link" | "signin" while the paste-code field is shown (mirrors the persisted dropboxPending mode)
  let codeValue = "";
  let focusCode = false;
  let authWinId = null; // the small Dropbox window, closed after Connect/Cancel
  let syncClicked = false; // Sync now clicked, answer (end of run) not yet received

  // Small popup window next to the manager (a tab would raise the browser window over the manager).
  async function openAuthWindow(url) {
    const size = { width: 520, height: 720 };
    try {
      let pos = {};
      try {
        const cur = await chrome.windows.getCurrent();
        pos = besidePosition(cur, size, { left: window.screen.availLeft, width: window.screen.availWidth });
      } catch { /* let Chrome place it */ }
      const win = await chrome.windows.create({ url, type: "popup", focused: true, ...size, ...pos });
      authWinId = win?.id ?? null;
    } catch {
      await chrome.tabs.create({ url });
    }
  }
  async function closeAuthWindow() {
    const id = authWinId;
    authWinId = null;
    if (id == null) return;
    try { await chrome.windows.remove(id); } catch { /* already closed */ }
  }

  // Step 1: ask the worker for the authorize URL (it persists the PKCE verifier), open it, show the paste field.
  async function beginDropbox(type) {
    if (signingIn) return;
    if (compact && signinInGate(compact) === "open-manager") {
      // Opening the Dropbox tab closes this popup and would lose the field: the manager window hosts it.
      try { await send({ type: "open-manager", panel: "sync" }); } catch { /* window opens anyway or not */ }
      window.close();
      return;
    }
    signingIn = true;
    render();
    try {
      const res = await send({ type: "sync-dropbox-begin", mode: type });
      if (!res || res.ok === false || !res.url) { onStatus(res?.error || "Could not start the Dropbox sign-in", true); return; }
      await openAuthWindow(res.url);
      codeEntry = type; codeValue = ""; focusCode = true;
    } catch (err) {
      onStatus(`Dropbox sign-in failed: ${err?.message ?? err}`, true);
    } finally {
      signingIn = false;
      render();
    }
  }

  // Step 2: exchange the pasted code (link when unlinked, sign in again when paused). Failures show the returned error.
  async function connectDropbox() {
    if (signingIn || !codeEntry) return;
    const chk = codeCheck(codeValue);
    if (chk.error) { onStatus(chk.error, true); return; }
    const type = codeEntry === "signin" ? "sync-signin-dropbox" : "sync-link-dropbox";
    signingIn = true;
    render();
    try {
      const res = await send({ type, code: chk.code });
      if (res && res.ok === false) {
        // Dropbox answered: the verifier is spent, start again. No answer (retry): keep the field, press Connect again.
        if (!res.retry) { codeEntry = null; closeAuthWindow(); }
        onStatus(res.error || "Dropbox sign-in failed", true);
        return;
      }
      codeEntry = null; codeValue = "";
      closeAuthWindow();
      decisionDismissed = false;
    } catch (err) {
      onStatus(`Dropbox sign-in failed: ${err?.message ?? err}`, true); // field stays: the verifier may still be pending
    } finally {
      signingIn = false;
      render();
    }
  }

  async function cancelCode() {
    codeEntry = null; codeValue = "";
    closeAuthWindow();
    try { await send({ type: "sync-dropbox-cancel" }); } catch { /* pending expires by itself */ }
    render();
  }

  // The verifier is spent once Dropbox answered, so after a failure the user starts again (codeEntry reset above).
  function codeRow() {
    const input = el("input", { type: "text", placeholder: "Paste the code from Dropbox", ariaLabel: "Dropbox code", value: codeValue, disabled: signingIn, autocomplete: "off", spellcheck: false });
    input.oninput = () => { codeValue = input.value; };
    input.onkeydown = (e) => { if (e.key === "Enter") connectDropbox(); };
    if (focusCode) { focusCode = false; setTimeout(() => input.focus(), 0); }
    input.className = "codeinput";
    return el("div", { className: "coderow" }, input,
      row(btn("Connect", connectDropbox, { className: "primary", disabled: signingIn }), btn("Cancel", cancelCode, { disabled: signingIn })));
  }

  async function syncNow() {
    if (syncClicked) return;
    syncClicked = true;
    render(); // disabled + spinner immediately, before the state arrives
    try { await send({ type: "sync-now" }); } catch { /* state shows the outcome */ } finally { syncClicked = false; render(); }
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
      const inCode = codeEntry === "signin";
      root.append(row(el("span", { className: "err", textContent: pv.text }), ...(inCode ? [] : [btn(pv.actionLabel, () => beginDropbox("signin"), { className: "primary", disabled: signingIn })])));
      if (inCode) root.append(codeRow());
    }
    if (st.status === "needs-decision" && withCancel && decisionDismissed) {
      root.append(row(el("span", { className: "err", textContent: "Sync is stopped until you decide." }), btn("Decide...", () => { decisionDismissed = false; render(); })));
    }
    if (st.status === "needs-decision" && st.decision && !(withCancel && decisionDismissed)) {
      const n = st.decision.conflicts;
      root.append(
        el("p", { className: "err", textContent: `${n} snippet${n === 1 ? "" : "s"} conflict (deleted on one side or edited on both). Choose which side wins for these. Everything else is merged.` }),
        row(
          btn("Dropbox wins", () => send({ type: "sync-decide", choice: "folder" })),
          btn("This device wins", () => send({ type: "sync-decide", choice: "local" })),
          ...(withCancel ? [btn("Cancel", () => { send({ type: "sync-decide", choice: "cancel" }); decisionDismissed = true; render(); })] : []),
        ),
      );
    }
  }

  // Keep the paste field in step with state and with the persisted pending sign-in: drop it when it no longer
  // applies (unlinked/backend change), restore it after the manager was closed or reloaded mid-flow.
  async function syncCodeEntry(st) {
    if (codeEntry && !codeApplies(st, codeEntry)) {
      codeEntry = null; codeValue = "";
      try { await send({ type: "sync-dropbox-cancel" }); } catch { /* expires by itself */ }
    }
    if (!codeEntry && !signingIn && (!st.linked || st.status === "paused")) {
      try {
        const res = await send({ type: "sync-dropbox-pending" });
        if (res?.mode && codeApplies(st, res.mode)) { codeEntry = res.mode; codeValue = ""; focusCode = true; }
      } catch { /* no restore */ }
    }
  }

  async function render() {
    const st = await state.get();
    if (compact && !needsAttention(st)) { onResolved?.(); return; }
    if (!compact) await syncCodeEntry(st);
    root.replaceChildren(el("h2", { textContent: "Sync" }));
    if (compact) { banners(st, false); return; }
    if (!st.linked) {
      root.append(
        el("p", { className: "placeholder", textContent: "Sync your snippets between devices with Dropbox." }),
        codeEntry === "link"
          ? el("div", {}, el("p", { className: "muted", textContent: "Allow access on the Dropbox page, copy the code it shows, and paste it here." }), codeRow())
          : row(btn("Sign in to Dropbox...", () => beginDropbox("link"), { className: "primary", disabled: signingIn })),
      );
      return;
    }
    banners(st, true);
    const lv = linkedView(st);
    root.append(row(el("span", { textContent: lv.label })));
    const busy = syncBusy(st, syncClicked);
    const sv = syncButtonView(busy);
    const syncBtn = btn(sv.label, syncNow, { disabled: sv.disabled, ariaBusy: String(busy) });
    if (sv.spinner) syncBtn.prepend(el("span", { className: "spinner", ariaHidden: "true" }));
    root.append(row(el("span", { textContent: statusText(st) }), syncBtn));
    if (st.message && st.status !== "error" && st.status !== "paused") root.append(el("p", { className: "muted", textContent: st.message }));
    if (st.summary) root.append(el("p", { className: "muted", textContent: `First sync: ${st.summary}` }));
    const sel = el("select", { ariaLabel: "Check every" });
    for (const i of INTERVALS) sel.append(new Option(i.label, String(i.min), false, i.min === st.intervalMin));
    sel.onchange = () => send({ type: "sync-set-interval", min: Number(sel.value) });
    root.append(row(el("label", {}, "Check every: ", sel)));
    if (confirmUnlink) {
      root.append(
        el("p", { className: "err", textContent: unlinkText(st) }),
        row(btn("Cancel", () => { confirmUnlink = false; render(); }), btn("Unlink", async () => { confirmUnlink = false; await send({ type: "sync-unlink" }); }, { disabled: unlinkDisabled(busy) })),
      );
    } else {
      root.append(row(btn("Unlink", () => { confirmUnlink = true; render(); }, { disabled: unlinkDisabled(busy) })));
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.sync) return;
    if (changes.sync.newValue?.status !== "needs-decision") decisionDismissed = false;
    if (!root.hidden) render();
  });
  return { render };
}

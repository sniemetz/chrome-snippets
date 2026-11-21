// Pure view decisions for the sync panel (no DOM), so they can be unit-tested.
const isDropbox = (st) => st.backend === "dropbox";

// Paused banner: Dropbox text comes from state when present (folder text is fixed, as before); the action depends on the backend.
export function pausedView(st) {
  if (isDropbox(st)) {
    return { text: st.message || "Sign in to Dropbox again", actionLabel: "Sign in", action: "signin" };
  }
  return { text: "Folder access must be re-allowed", actionLabel: "Re-allow folder", action: "reallow" };
}

// Text of the status line when paused (folder wording kept as before).
export const pausedStatusText = (st) =>
  isDropbox(st) ? (st.message || "Sign in to Dropbox again") : "Sync paused: folder access must be re-allowed";

// Header row of a linked panel.
export function linkedView(st) {
  return isDropbox(st)
    ? { label: `Dropbox: ${st.account || "connected"}`, showChangeFolder: false }
    : { label: `Folder: ${st.folderName}`, showChangeFolder: true };
}

// Unlink confirmation wording.
export const unlinkText = (st) => isDropbox(st)
  ? "Unlink Dropbox? Snippets and Dropbox files stay as they are. Snippets deleted on either side since the last sync come back if you link again."
  : "Unlink this folder? Snippets and folder files stay as they are. Snippets deleted on either side since the last sync come back if you link again.";

// Paused Dropbox sign-in needs a text field that must survive the toolbar popup closing (opening the Dropbox
// tab closes it), so the compact toolbar gate opens the manager window instead of signing in itself.
export const signinInGate = (compact) => (compact ? "open-manager" : "inline");

// Sync now button / Unlink guard. busy = a run is in flight (persisted `syncing` flag or a click not yet answered).
export const syncBusy = (st, clicked = false) => !!clicked || !!st.syncing;
export const syncButtonView = (busy) => ({ label: busy ? "Syncing..." : "Sync now", disabled: !!busy, spinner: !!busy });
export const unlinkDisabled = (busy) => !!busy;

// Does a pending/open paste field of this mode ("link"|"signin") still make sense for the current state?
export function codeApplies(st, mode) {
  if (mode === "link") return !st.linked;
  if (mode === "signin") return !!st.linked && isDropbox(st) && st.status === "paused";
  return false;
}

// Code-paste step: returns the trimmed code or an inline message (no request is sent for an empty code).
export function codeCheck(raw) {
  const code = String(raw ?? "").trim();
  return code ? { code } : { error: "Paste the code from Dropbox first." };
}

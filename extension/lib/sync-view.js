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
    ? { label: `Dropbox: ${st.account}`, showChangeFolder: false }
    : { label: `Folder: ${st.folderName}`, showChangeFolder: true };
}

// Unlink confirmation wording.
export const unlinkText = (st) => isDropbox(st)
  ? "Unlink Dropbox? Snippets and Dropbox files stay as they are. Snippets deleted on either side since the last sync come back if you link again."
  : "Unlink this folder? Snippets and folder files stay as they are. Snippets deleted on either side since the last sync come back if you link again.";

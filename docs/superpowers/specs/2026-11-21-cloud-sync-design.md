# Cloud sync (Dropbox first) - design

Status: approved and implemented. Branch: `cloud-sync`. Builds on `2026-11-18-folder-sync-design.md`.
Items marked **[call]** are my decisions, open to correction.

## Intent
- Why: the local-folder backend asks the user to re-allow folder access repeatedly (Windows with a Drive sync folder, Linux with an rclone FUSE mount). It is not workable day to day.
- Goal: one-time setup, then periodic sync that survives Chrome restarts, with no further prompts.

## Goals
- Dropbox as a sync backend, signed in once.
- Same sync semantics as today: per-snippet `<uuid>.json` files, same planner, engine, guard and name-clash rules.
- Drive may follow later (see Approaches); the design must not block it.
- After Dropbox is verified working by the user, remove the local-folder backend.

## Non-goals
- Browsing or editing the synced files by hand in Dropbox is not a goal (app folder; files stay readable JSON, though).
- No Drive in this branch. No other providers. No server component.
- No change to planner, guard or clash logic.

## Anti-goals
- Any recurring prompt after setup (sign-in or permission) in normal use.
- Secrets in the repo. (PKCE needs no client secret; the Dropbox app key is public by design.)

## Constraints
- MV3 service worker does all sync; it can be killed at any time. Tokens live in `chrome.storage.local`, not in memory.
- Sign-in is the no-redirect code-paste flow (see "Decided: code-paste sign-in"); no `chrome.identity`.
- No OAuth redirect URI and no fixed manifest `key`: the sign-in does not depend on the extension ID.
- Setup: none for users (embedded public app key). Developers who register their own app: scoped access, "App folder", 4 scopes Submitted, PKCE on, no redirect URI.
- New permissions: host permissions `https://api.dropboxapi.com/*`, `https://content.dropboxapi.com/*` (no `identity`).
- The Dropbox app is registered once by the developer (scoped access, "App folder", scopes `files.content.read`, `files.content.write`, `files.metadata.read`, `account_info.read` **[call: list_folder and the account name need the last two]**); its public key is embedded in `lib/dropbox-config.js`.

## Approaches
- A (chosen): Dropbox first, Drive second, both behind the existing `folder` interface. Fastest path to the goal; proves the adapter contract before the harder Google auth.
- B: both at once. One large branch, two auth setups failing together.
- C: Drive only. Smallest scope but the hardest auth (Chrome-signed-in `getAuthToken`, Cloud consent screen must be "In production" or tokens expire after 7 days).
- Chosen by the user: A, with the option to drop Google if it is a hassle.

## Design
- **Adapter** `lib/dropbox.js`: `createDropbox({ fetch, auth })` returns the same shape as `createFolder`:
  - `permission()`: `"granted"` if a refresh token is stored and not marked invalid, else `"denied"`. Local check only, no network. So a network error counts as a skipped file and never as a lost permission.
  - `list()`: `files/list_folder` (+`continue`), only `<uuid>.json`; `fileModified` = `server_modified` in ms; throws `FolderReadError` on failure (an unlistable folder must not look empty).
  - `read(id)`: `files/download`, parsed with `parseSnippetFile`, id must match the file name.
  - `write(sn)`: `files/upload`, mode overwrite; returns `{ fileModified }` from the response.
  - `remove(id)`: `files/delete_v2`; "not found" is success.
  - Retries: honour `429`/`Retry-After`, 1 retry on 5xx/network **[call]**; otherwise surface the error (the engine already skips per file and retries next run).
- **Auth** `lib/dropbox-auth.js`: PKCE (S256) authorization-code flow.
  - Link (code-paste): `sync-dropbox-begin` makes PKCE, stores `{verifier, mode: "link"|"signin", createdAt}` in `chrome.storage.local` `dropboxPending` (expires after 15 min; dropped once Dropbox answered the exchange, kept on a network failure so Connect can be pressed again; removed by Cancel and unlink; overwritten by a newer begin) and returns the authorize URL (no `redirect_uri`, no `state`: a foreign code fails the PKCE exchange). The manager's Sync panel opens it in a tab; Dropbox shows a code; the user pastes it; `sync-link-dropbox`/`sync-signin-dropbox` `{code}` exchanges it (no `redirect_uri`) with `token_access_type=offline` and stores `{refresh, access, expiresAt}`. A worker killed or a manager closed between the two steps loses nothing: on mount the panel restores the paste field from the pending entry (mode tells link from sign-in).
  - Access token refreshed on demand, 60 s early. Refresh failure with `invalid_grant` marks the link invalid: status "paused", message "Sign in to Dropbox again", button "Sign in". This is the only recurring-prompt case (user revoked access).
  - Unlink: delete stored tokens, best-effort `auth/token/revoke`.
- **State**: sync state gains `backend: "folder" | "dropbox"` and `account` (display name/email from `users/get_current_account`). `folderName` is kept for folder links. Default for existing state is `"folder"`.
- **Service worker**: `doSync` builds the adapter from `backend`. New message `sync-link-dropbox` (inside `exclusive`, like `sync-link`): sign in, reset state, `firstLink: true` sync. Switching backend behaves like "Change folder": `synced` is reset and the first-link merge rules apply.
- **UI (sync panel)**: unlinked: "Sign in to Dropbox..." opens the Dropbox tab, then shows "Paste the code from Dropbox" + Connect + Cancel; linked Dropbox shows the account and "Sign in" when paused (same paste step). The toolbar popup never hosts the paste field (opening the tab closes it), so the `compact` gate's paused "Sign in" sends `open-manager` with `{panel:"sync"}` (session flag `openPanel`), and the manager opens directly on the Sync panel, which hosts the paste field.
- **Sign-in failure or cancel** **[call]**: existing link, `synced` map and handle stay untouched until sign-in succeeds; state is reset only after. Same for "Sign in again". A failed exchange consumes the pending verifier: the user starts the sign-in again. Cancel only hides the paste field.
- **Engine messages** **[call]**: the adapter supplies its own "must be re-allowed / sign in again" text; the engine only calls `permission()` and uses the adapter's message. Small engine change, behaviour unchanged for folders.
- **Old folder handle** **[call]**: kept after switching to Dropbox (user may switch back); deleted by unlink and by the final removal task.
- **Plan scope** **[call]**: the plan ends before removal. Removal is a separate, gated follow-up.
- **Removal of the folder backend**: a final task, done only after the user confirms Dropbox works across two machines and restarts. Existing folder links then show a one-time "Move to Dropbox" notice. **[call]**
- **Docs**: README Sync section, `docs/spec.md`, a section in the folder-sync design doc, memory handoff.

## Testing
- Unit tests with a fake `fetch` standing in for the Dropbox API (list with paging, download, upload, delete, 429, 5xx, expired token refresh, `invalid_grant`), a fake `identity`, and the existing engine tests run against the adapter.
- Pure parts (PKCE verifier/challenge, URL building, token expiry) get direct tests.
- Manual: link on two machines, restart Chrome, wait through two sync intervals, revoke access in Dropbox and see the sign-in banner.

## Left to the builder
- File layout and names inside `lib/`, request helper structure, exact retry timing, message and button wording, test fake design.

## Decided: code-paste sign-in with an embedded public app key
Supersedes the earlier `launchWebAuthFlow` design, the per-machine redirect URI decision (unpacked extension IDs differ per machine; a fixed `key` would change the current install's ID and orphan its storage) and the "no fixed key" concern. Verified against real Dropbox: authorize URL without `redirect_uri` makes Dropbox display an access code; the token endpoint accepts it with the PKCE verifier and no `redirect_uri`. The app key is a public client id (PKCE, no secret) and is embedded. Cost: one paste step. Same approach as Super Productivity.

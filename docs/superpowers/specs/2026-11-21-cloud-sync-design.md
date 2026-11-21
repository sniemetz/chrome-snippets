# Cloud sync (Dropbox first) - design

Status: draft for approval. Branch: `cloud-sync`. Builds on `2026-11-18-folder-sync-design.md`.
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
- Chrome only (`chrome.identity.launchWebAuthFlow`).
- The OAuth redirect URL is `https://<extension-id>.chromiumapp.org/`. Unpacked extension IDs differ per machine, so the manifest gets no fixed `key`: each machine registers its own redirect URI (decided, see below).
- Setup per machine: read the ID from `chrome.runtime.id` (shown in the sync panel) and add `https://<id>.chromiumapp.org/` to the Dropbox app's redirect URIs.
- New permissions: `identity`; host permissions `https://api.dropboxapi.com/*`, `https://content.dropboxapi.com/*`.
- The user must register a Dropbox app (scoped access, "App folder", scopes `files.content.read`, `files.content.write`, `files.metadata.read`, `account_info.read` **[call: list_folder and the account name need the last two]**, plus the redirect URI). Only the user can do this; the app key is entered into the code/config afterwards.

## Approaches
- A (chosen): Dropbox first, Drive second, both behind the existing `folder` interface. Fastest path to the goal; proves the adapter contract before the harder Google auth.
- B: both at once. One large branch, two auth setups failing together.
- C: Drive only. Smallest scope but the hardest auth (Chrome-signed-in `getAuthToken`, Cloud consent screen must be "In production" or tokens expire after 7 days).
- Chosen by the user: A, with the option to drop Google if it is a hassle.

## Design
- **Adapter** `lib/dropbox.js`: `createDropbox({ fetch, tokens })` returns the same shape as `createFolder`:
  - `permission()`: `"granted"` if a refresh token is stored and not marked invalid, else `"denied"`. Local check only, no network. So a network error counts as a skipped file and never as a lost permission.
  - `list()`: `files/list_folder` (+`continue`), only `<uuid>.json`; `fileModified` = `server_modified` in ms; throws `FolderReadError` on failure (an unlistable folder must not look empty).
  - `read(id)`: `files/download`, parsed with `parseSnippetFile`, id must match the file name.
  - `write(sn)`: `files/upload`, mode overwrite; returns `{ fileModified }` from the response.
  - `remove(id)`: `files/delete_v2`; "not found" is success.
  - Retries: honour `429`/`Retry-After`, 1 retry on 5xx/network **[call]**; otherwise surface the error (the engine already skips per file and retries next run).
- **Auth** `lib/dropbox-auth.js`: PKCE (S256) authorization-code flow.
  - Link: the service worker calls `launchWebAuthFlow({interactive:true})` with `token_access_type=offline`, exchanges the code, stores `{refresh, access, expiresAt}` **[call: sw does it, since a popup page closes when the auth window opens]**.
  - Access token refreshed on demand, 60 s early. Refresh failure with `invalid_grant` marks the link invalid: status "paused", message "Sign in to Dropbox again", button "Sign in". This is the only recurring-prompt case (user revoked access).
  - Unlink: delete stored tokens, best-effort `auth/token/revoke`.
- **State**: sync state gains `backend: "folder" | "dropbox"` and `account` (display name/email from `users/get_current_account`). `folderName` is kept for folder links. Default for existing state is `"folder"`.
- **Service worker**: `doSync` builds the adapter from `backend`. New message `sync-link-dropbox` (inside `exclusive`, like `sync-link`): sign in, reset state, `firstLink: true` sync. Switching backend behaves like "Change folder": `synced` is reset and the first-link merge rules apply.
- **UI (sync panel)**: choose "Dropbox" or "Local folder" when unlinked; linked Dropbox shows the account and "Sign in again" when paused; `compact` gate shows "Sign in" instead of "Re-allow folder".
- **Sign-in failure or cancel** **[call]**: existing link, `synced` map and handle stay untouched until sign-in succeeds; state is reset only after. Same for "Sign in again". The panel re-renders from storage (the popup may close; the response is not relied on). No keep-alive: the pending `launchWebAuthFlow` call is enough.
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

## Decided: extension ID (user chose option 2)
A fixed `key` changes the ID of the current unpacked install, so Chrome sees a new extension with empty storage (snippets live in `chrome.storage.local`). Options: (1) add `key`, export snippets first, import after (one-time, per machine); (2) no `key`: register each machine's own redirect URI in the Dropbox app (it accepts several) and read the ID from `chrome.runtime.id`; no data risk, but every new machine/path needs its URI added.

# Dropbox Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dropbox as a sync backend (sign in once, syncs periodically through Chrome restarts), behind the existing `folder` interface.

**Architecture:** `lib/dropbox-auth.js` (PKCE sign-in, token refresh, token storage) and `lib/dropbox.js` (adapter with the same shape as `createFolder`) take injected `fetch`/`identity`/storage so they are unit-testable. The service worker picks the adapter from `state.backend`. Planner, guard and clash logic are untouched; the engine only learns to take its "paused" message from the adapter.

**Tech Stack:** Chrome MV3, vanilla ES modules, `node --test`, Dropbox HTTP API v2, `chrome.identity.launchWebAuthFlow`.

**Spec:** `docs/superpowers/specs/2026-11-21-cloud-sync-design.md` (builds on `2026-11-18-folder-sync-design.md`).

## Global Constraints

- Branch `cloud-sync`. Commits without Claude attribution lines. Add files by name, never `git add -A`.
- Tests: `npm test` (`node --test`), must stay green after every task (currently 187).
- No manifest `key`. Redirect URL is `https://<chrome.runtime.id>.chromiumapp.org/` (user registers it per machine).
- New manifest entries: permission `identity`; `host_permissions`: `https://api.dropboxapi.com/*`, `https://content.dropboxapi.com/*`.
- Dropbox scopes (registered by the user): `files.content.read`, `files.content.write`, `files.metadata.read`, `account_info.read`. App folder access; files are `/<uuid>.json` at the app-folder root, same JSON as the folder backend (`parseSnippetFile`).
- Tokens only in `chrome.storage.local` key `dropboxAuth` (service worker may be killed any time). No secrets in the repo; the app key lives in `extension/lib/dropbox-config.js` as `DROPBOX_APP_KEY` (empty string until the user supplies it).
- `permission()` of the Dropbox adapter is a local check only (no network).
- Existing folder-backend behaviour must not change. The folder backend stays in this plan; removal is a separate gated follow-up.

## Review Focus

- Expired access token mid-run: refresh once, retry the request; no prompt. (Task 3)
- Refresh token revoked (`invalid_grant`): status becomes paused "Sign in to Dropbox again", never a silent loop of errors. (Tasks 2, 3)
- Network failure or 5xx on one file: skipped per file by the engine, never reported as lost permission. (Tasks 3, 4)
- Cancelled or failed sign-in while already linked: existing link, `synced` map and folder handle untouched. (Task 5)
- Dropbox `server_modified` has 1 s resolution: `fileModified` is whole seconds in ms; a listing must still match what `write()` returned for the same file. (Task 3)

---

### Task 1: Sync state fields

**Files:** Modify `extension/lib/sync-state.js`; Test `test/sync-state.test.js`.

**Interfaces:**
- Produces: `defaultState()` gains `backend: "folder"` (values `"folder" | "dropbox"`) and `account: ""`. `needsAttention` unchanged.

- [ ] **Step 1:** Add test `defaultState has backend folder and empty account` and `state saved without backend reads back as folder` (area pre-filled with an old-shape object).
- [ ] **Step 2:** Run `node --test test/sync-state.test.js`; expect FAIL.
- [ ] **Step 3:** Add the two fields to `defaultState`.
- [ ] **Step 4:** Run the same command; expect PASS. Then `npm test`; expect all green.
- [ ] **Step 5:** Commit `feat: sync state backend and account fields`.

### Task 2: Dropbox auth module

**Files:** Create `extension/lib/dropbox-config.js`, `extension/lib/dropbox-auth.js`; Test `test/dropbox-auth.test.js`.

**Interfaces:**
- Produces in `dropbox-config.js`: `export const DROPBOX_APP_KEY = ""`.
- Produces in `dropbox-auth.js`:
  - `makePkce(random = crypto) -> Promise<{ verifier: string, challenge: string }>` (verifier 43-128 chars base64url; challenge = base64url(SHA-256(verifier)), no padding).
  - `buildAuthUrl({ appKey, redirectUri, challenge }) -> string` (`https://www.dropbox.com/oauth2/authorize`, params `client_id`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `token_access_type=offline`, `redirect_uri`).
  - `createDropboxAuth({ fetch, area, appKey, now = Date.now }) -> { signIn(code, verifier, redirectUri), accessToken(), hasLink(), isInvalid(), clear(), revoke() }`. `signIn` POSTs `https://api.dropboxapi.com/oauth2/token` (form: `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`) and stores `{ refresh, access, expiresAt, invalid: false }` under `dropboxAuth`. `accessToken()` returns the stored token, refreshing (`grant_type=refresh_token`, `refresh_token`, `client_id`) when fewer than 60 s remain; on an `invalid_grant` error body it stores `invalid: true` and throws `DropboxAuthError`. `hasLink()` = refresh token present and not invalid (async, local only). `revoke()` is best-effort POST to `https://api.dropboxapi.com/2/auth/token/revoke`, never throws. `clear()` removes `dropboxAuth`.
  - `export class DropboxAuthError extends Error`.

- [ ] **Step 1:** Write tests with a fake `fetch` and `memArea`: PKCE challenge equals the known SHA-256 base64url of a fixed verifier; `buildAuthUrl` contains every param; `signIn` stores tokens; `accessToken` returns cached token without a fetch while valid; refreshes when within 60 s of `expiresAt` (assert request body); `invalid_grant` sets `invalid` and throws `DropboxAuthError` and `hasLink()` becomes false; a network error on refresh throws a plain Error and leaves `invalid` false; `revoke` swallows errors.
- [ ] **Step 2:** Run `node --test test/dropbox-auth.test.js`; expect FAIL (module missing).
- [ ] **Step 3:** Implement per the interface (Web Crypto, `URLSearchParams` bodies).
- [ ] **Step 4:** Run the file; expect PASS. `npm test`; all green.
- [ ] **Step 5:** Commit `feat: Dropbox PKCE auth module`.

### Task 3: Dropbox adapter

**Files:** Create `extension/lib/dropbox.js`, `test/helpers/fake-dropbox.js`; Test `test/dropbox.test.js`.

**Interfaces:**
- Consumes: `createDropboxAuth(...)` object (Task 2) as `auth`; `parseSnippetFile`, `FolderReadError` from `lib/folder.js`.
- Produces: `createDropbox({ fetch, auth, sleep = ms => new Promise(r => setTimeout(r, ms)) }) -> { permission, list, read, write, remove, accountName, pausedMessage }`, same shapes as `createFolder`:
  - `permission()` -> `"granted"` if `await auth.hasLink()` else `"denied"`.
  - `pausedMessage` = `"Sign in to Dropbox again"`.
  - `list()` -> `[{ id, fileModified, size }]`, `POST https://api.dropboxapi.com/2/files/list_folder` `{ path: "", limit: 2000 }` + `/continue` with `cursor` while `has_more`; only files named `<uuid>.json`; `fileModified = Date.parse(server_modified)`. Any failure throws `FolderReadError`.
  - `read(id)` -> `POST https://content.dropboxapi.com/2/files/download`, header `Dropbox-API-Arg: {"path":"/<id>.json"}`; parse with `parseSnippetFile`; id must match, else `FolderReadError`.
  - `write(sn) -> { fileModified }`: `POST https://content.dropboxapi.com/2/files/upload`, header `Dropbox-API-Arg: {"path":"/<id>.json","mode":"overwrite","mute":true}`, `Content-Type: application/octet-stream`, body the same JSON the folder backend writes; `fileModified` from the response `server_modified`.
  - `remove(id)`: `POST /2/files/delete_v2` `{ path }`; a `path_lookup/not_found` (409) is success.
  - `accountName() -> string` via `POST /2/users/get_current_account` (display name, else email).
  - Every request: header `Authorization: Bearer <await auth.accessToken()>`. A `401` refreshes once (call `auth.accessToken()` again after forcing expiry is not needed: retry once, the second 401 throws). `429` waits `Retry-After` seconds then retries once; `5xx` or network failure retries once; then the error is thrown. `DropboxAuthError` propagates unchanged.
- `test/helpers/fake-dropbox.js` exports `fakeDropbox()` -> `{ fetch, files: Map, calls }` implementing the endpoints above with failure injection (`failNext(status)`, `expireToken()`).

- [ ] **Step 1:** Write `test/dropbox.test.js`: list pages through `has_more` and ignores non-`<uuid>.json` names; list failure throws `FolderReadError`; write then list returns the same `fileModified` (whole seconds); read round-trips and rejects id mismatch/garbage with `FolderReadError`; remove of a missing file succeeds; `401` triggers exactly one retry; `429` retries after `Retry-After` (inject `sleep`); `500` retried once then thrown; `permission()` is `"denied"` after `invalid_grant`, with no network call made.
- [ ] **Step 2:** Run `node --test test/dropbox.test.js`; expect FAIL.
- [ ] **Step 3:** Implement `createDropbox` with one private `call(url, init)` helper that holds the retry rules.
- [ ] **Step 4:** Run the file; expect PASS. Add test `engine syncs against the Dropbox adapter` in `test/sync-engine.test.js` using `fakeDropbox` through `runSync` (first-link merge of 2 local + 2 remote snippets). Run `npm test`; all green.
- [ ] **Step 5:** Commit `feat: Dropbox folder adapter`.

### Task 4: Engine uses the adapter's paused message

**Files:** Modify `extension/lib/sync-engine.js:15-17,113,129`; Test `test/sync-engine.test.js`.

**Interfaces:**
- Consumes: optional `folder.pausedMessage` (string).
- Produces: unchanged `runSync` signature; the paused `message` is `folder.pausedMessage ?? "Folder access must be re-allowed"`.

- [ ] **Step 1:** Add tests: fake folder with `pausedMessage = "Sign in to Dropbox again"` and `perm = "denied"` -> state message equals it; a fake folder without the field keeps the old message (existing tests must still pass).
- [ ] **Step 2:** Run `node --test test/sync-engine.test.js`; expect the new test FAIL.
- [ ] **Step 3:** Replace the three hardcoded strings with one `const pausedMsg`.
- [ ] **Step 4:** Run `npm test`; all green.
- [ ] **Step 5:** Commit `feat: engine takes paused message from the adapter`.

### Task 5: Manifest and service worker

**Files:** Modify `extension/manifest.json`, `extension/background/sw.js`, `test/manifest.test.js` (adjust expected permissions); Test additions in `test/manifest.test.js`.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: runtime message `{ type: "sync-link-dropbox" }` -> `{ ok: boolean, error?: string }`; message `{ type: "sync-signin-dropbox" }` (re-sign-in while linked, same flow) -> same response. `doSync` builds `createDropbox({ fetch, auth: createDropboxAuth({ fetch, area: chrome.storage.local, appKey: DROPBOX_APP_KEY }) })` when `state.backend === "dropbox"`, otherwise the folder adapter as today. After a run with a Dropbox adapter that reported `"denied"`, the badge logic is unchanged (`paused` already shows `!`).

- [ ] **Step 1:** Update `test/manifest.test.js` expectations: `identity` in permissions, both `host_permissions` present, no `key` field. Run; expect FAIL.
- [ ] **Step 2:** Edit the manifest. Run the manifest test; expect PASS.
- [ ] **Step 3:** In `sw.js` implement the flow inside `exclusive`: sign in first (`makePkce`, `chrome.identity.launchWebAuthFlow({ url: buildAuthUrl(...), interactive: true })`, read `code` from the returned URL, `auth.signIn`), and only when that succeeds call `syncState.clear()`, set `{ linked: true, backend: "dropbox", account: await dropbox.accountName(), folderName: "" }`, `ensureAlarm({ force: true })`, `doSync({ firstLink: true })`. Cancel or any failure returns `{ ok: false, error }` and changes nothing (existing link, `synced`, folder handle). `sync-signin-dropbox`: same sign-in, then `syncState.set({ status: "ok", message: "" })` and `enqueue()`; no reset of `synced`. `sync-unlink`: when `backend === "dropbox"` call `auth.revoke()` then `auth.clear()`; the folder handle is left alone. If `DROPBOX_APP_KEY` is empty the link message returns `{ ok: false, error: "Dropbox app key not configured" }`.
- [ ] **Step 4:** `node --check extension/background/sw.js`; `npm test`; all green. (Glue is verified manually in Task 7.)
- [ ] **Step 5:** Commit `feat: service worker Dropbox link, sign-in and unlink`.

### Task 6: Sync panel UI

**Files:** Modify `extension/popup/sync-panel.js`, `extension/popup/popup.js` (wiring only), `extension/popup/popup.html`/`popup.css` only if a new element needs styling.

**Interfaces:**
- Consumes: `send({ type: "sync-link-dropbox" | "sync-signin-dropbox" })`; `state.backend`, `state.account`, `state.folderName`; `chrome.runtime.id`.
- Produces: unlinked view shows two buttons, "Sign in to Dropbox..." (primary) and "Choose local folder...", plus the line `Extension ID: <id>` and the hint "Add https://<id>.chromiumapp.org/ as a redirect URI in the Dropbox app" . Linked Dropbox view shows `Dropbox: <account>`, "Sync now", interval, Unlink; no "Change folder". Paused Dropbox: banner "Sign in to Dropbox again" with a "Sign in" button (sends `sync-signin-dropbox`); compact (toolbar gate) shows the same instead of "Re-allow folder". A failed link shows the returned `error` through `onStatus(msg, true)`.

- [ ] **Step 1:** Implement the view changes (the file is DOM glue, not unit-tested in this project).
- [ ] **Step 2:** `node --check` on both files; `npm test`; all green.
- [ ] **Step 3:** Commit `feat: sync panel Dropbox sign-in and status`.

### Task 7: Docs and manual verification

**Files:** Modify `README.md` (Sync section: Dropbox setup steps incl. registering the app, scopes, per-machine redirect URI, `DROPBOX_APP_KEY`), `docs/spec.md`, `docs/superpowers/specs/2026-11-18-folder-sync-design.md` (pointer to the new design).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Hand the user this manual checklist (user runs it; nothing here is automated): register the Dropbox app and enter the key; reload the extension; sign in; sync two machines; close and restart Chrome; wait two sync intervals with no prompt; revoke access in Dropbox, see the sign-in banner and recover with "Sign in".
- [ ] **Step 3:** Commit `docs: Dropbox sync`. Do not merge; merging and the later folder-backend removal need the user's explicit approval.

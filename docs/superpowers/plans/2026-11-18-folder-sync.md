# Folder Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-way background sync between `chrome.storage.local` and one user-picked folder of `<id>.json` files, so the same snippets can be used on several devices through the user's own sync tool.

**Architecture:** A pure planner (`sync-plan.js`) decides actions from three inputs (local metadata, folder listing, last-synced record). A thin engine (`sync-engine.js`) performs them through two interfaces (the store and a `Folder`), so everything but the browser glue is unit-tested with fakes. The service worker triggers runs (local change, alarm, idle, startup, manual) using the persistent folder permission the spike verified. A Sync panel in the manager window links, shows status and resolves the guard.

**Tech Stack:** Vanilla JS ES modules, MV3, File System Access API, IndexedDB (handle), `chrome.alarms`, `chrome.idle`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-folder-sync-design.md` (approved 2026-11-18). Read it first; this plan does not repeat its reasoning.

**Prerequisite:** branch `popup-editor` is merged to `master` (the UI tasks edit the footer and `popup.js` it changed). Work on a new branch `folder-sync`.

## Global Constraints

- Permissions: add only `alarms` and `idle` to `extension/manifest.json`; everything else unchanged (`optional_host_permissions` stays).
- Folder files: `<uuid>.json`, matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$`; body `{ "version": 1, "id", "name", "content", "tags", "created", "modified" }`. Other files and folders are ignored and never touched.
- Interval choices exactly: `15 min` (default), `30 min`, `1 h`, `2 h`, `6 h`, `12 h` (minutes 15, 30, 60, 120, 360, 720).
- Guard: conflicts > `max(5, 0.2 * max(localCount, folderCount))`, or folder empty while local is not (or the reverse) with a non-empty `synced`. Not applied on first link.
- Local-change debounce 2000 ms. Content is read only to edit, paste, search, export, and to sync a snippet that actually changed.
- A read or parse failure is never a deletion. Nothing is applied while the guard is tripped.
- No `confirm()`/`alert()`; inline confirmations only. Plain commit messages, no attribution lines.

## Review Focus

1. Folder contains other files, subfolders, or non-matching names: ignored, never deleted or read. (Task 4)
2. A corrupt, half-synced or unreadable file: skipped, counted, retried; never treated as a deletion. (Tasks 4, 7)
3. Folder temporarily empty (drive unmounted) while `synced` is non-empty: guard trips, nothing deleted. (Task 8)
4. The same name clash seen from two devices resolves to the same winner and the same rename. (Task 2)
5. After a run, an immediate second run does nothing (no echo loop from our own writes). (Task 8)
6. Permission lost before or during a run: status `paused`, no data changed, `synced` consistent. (Task 7)
7. Edit beats delete in both directions; both-changed picks the newest `modified`. (Tasks 3, 7)
8. Restore of a smaller library, or unlink then re-link: guard or first-link merge behaves as in spec 6.4/6.4a. (Tasks 8, 10)

---

## File Structure

| File | Responsibility |
|---|---|
| `extension/lib/store.js` | tag ops bump `modified`; `upsertMany`, `removeMany` |
| `extension/lib/name-clash.js` | deterministic same-name decision |
| `extension/lib/sync-plan.js` | pure planner and guard |
| `extension/lib/folder.js` | `Folder` over a directory handle; file parse |
| `extension/lib/sync-state.js` | persisted sync state, intervals |
| `extension/lib/sync-engine.js` | one sync run (applies a plan) |
| `extension/lib/editor-sync.js` | classify an external change to the open snippet |
| `extension/background/sw.js` | triggers, badge, messages |
| `extension/popup/handle-store.js` | IndexedDB directory handle |
| `extension/popup/sync-panel.js` + popup html/css/js | Sync panel and notices |

Shared types used below: `Snippet = {id,name,content,tags,created,modified}`; `Meta = {id,name,tags,preview,created,modified}`.

---

### Task 1: Store support for sync

**Files:** Modify `extension/lib/store.js`; Test `test/store.test.js`

**Interfaces:**
- Produces on the store object:
  - `renameTag` / `deleteTag` now also set `modified: now()` on every snippet they change (still meta only, still no content read).
  - `upsertMany(snippets: Snippet[]): Promise<void>` — for each snippet, replace the meta entry with the same id or append; write `c:<id>`; keep `id`, `created`, `modified` exactly as given; no validation, no name-uniqueness check (caller validated).
  - `removeMany(ids: string[]): Promise<void>` — remove those metas and their `c:<id>` keys; unknown ids ignored.

- [ ] **Step 1: Write failing tests:**
  - `renameTag bumps modified only on changed snippets` (clock `now` advances; unchanged snippet keeps `modified`).
  - `deleteTag bumps modified only on changed snippets`.
  - `upsertMany inserts new and replaces existing by id, preserving id/created/modified`.
  - `upsertMany reads no content keys` (`contentKeysRead(area)` empty).
  - `removeMany deletes metas and content keys, ignores unknown ids`.
- [ ] **Step 2: Run** `node --test test/store.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three changes in `store.js`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: store upsertMany/removeMany, tag edits bump modified`.

---

### Task 2: Name clash rule

**Files:** Create `extension/lib/name-clash.js`; Test `test/name-clash.test.js`

**Interfaces:**
- Produces: `decideClash(a: Snippet, b: Snippet, takenNames: Set<string>): { kind: "same", keep: string, drop: string } | { kind: "rename", id: string, newName: string }` where `takenNames` holds lower-cased names already in use. Order of `a`/`b` must not matter.
  - Identical `content` (and same lower-cased name): `kind:"same"`, `keep` = smaller `id` (string comparison), `drop` = the other.
  - Different content: `kind:"rename"` of the snippet with the larger `id`; `newName` = `"<name> (2)"`, or the next free number when `(2)` is in `takenNames` (case-insensitive).

- [ ] **Step 1: Write failing tests:**
  - identical content: `decideClash(x, y, set)` and `decideClash(y, x, set)` both return `{kind:"same", keep: smallerId, drop: largerId}` (Review Focus 4).
  - different content: both argument orders rename the larger id to `"Email signature (2)"`.
  - `(2)` taken: result `"Email signature (3)"`; `takenNames` comparison is case-insensitive.
- [ ] **Step 2: Run** `node --test test/name-clash.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `decideClash`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: deterministic name clash rule`.

---

### Task 3: Sync planner

**Files:** Create `extension/lib/sync-plan.js`; Test `test/sync-plan.test.js`

**Interfaces:**
- Produces:
```js
// local: [{id, modified}], folder: [{id, fileModified}], synced: {[id]: {modified, fileModified}}
planSync({ local, folder, synced, firstLink }):
  { actions: Action[], guard: { tripped: boolean, conflicts: number, threshold: number,
                                reason: null | "count" | "folder-empty" | "local-empty" } }
// Action = { type: "push"|"pull"|"deleteLocal"|"deleteFile"|"forget"|"conflict", id: string }
```
- Rows (spec 6.4): local-only not synced = `push`; folder-only not synced = `pull`; both, synced, neither changed = no action; local changed only = `push`; folder changed only = `pull`; both changed = `conflict`; no local + folder + synced: `deleteFile` unless the file changed (`fileModified !== synced.fileModified`) then `pull`; local + no folder + synced: `deleteLocal` unless local changed (`modified !== synced.modified`) then `push`; neither side + synced = `forget`.
- `firstLink: true` (synced empty): id on both sides is a `conflict`; guard never trips.
- Conflicts counted for the guard = `deleteLocal` + `deleteFile` + `conflict` actions. Threshold `max(5, 0.2 * max(local.length, folder.length))`; trip when count > threshold (`reason:"count"`), or folder empty with local non-empty / local empty with folder non-empty while `Object.keys(synced).length > 0` (`"folder-empty"` / `"local-empty"`).

- [ ] **Step 1: Write failing tests** (one per row above, with the spec's names), plus:
  - `edit beats delete (folder side)`: local missing, file changed → `pull`.
  - `edit beats delete (local side)`: folder missing, local changed → `push`.
  - `guard trips above threshold`: 20 local, 6 `deleteLocal` candidates → tripped (count 6 > max(5, 4)); 5 → not tripped.
  - `guard trips on empty folder with synced history` (Review Focus 3) and `not on first link`.
  - `plain pushes never count`: 50 changed-only-local snippets → not tripped.
- [ ] **Step 2: Run** `node --test test/sync-plan.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `planSync`** as a pure function (no I/O, no clock).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync planner and guard`.

---

### Task 4: Folder wrapper

**Files:** Create `extension/lib/folder.js`; Test `test/folder.test.js`

**Interfaces:**
- Produces:
```js
class FolderReadError extends Error {}                 // read, parse or validation failure
parseSnippetFile(text: string): Snippet                // throws FolderReadError (version !== 1, missing/invalid fields)
createFolder(dirHandle): {
  permission(): Promise<"granted"|"prompt"|"denied">,  // dirHandle.queryPermission({mode:"readwrite"})
  list(): Promise<{ id: string, fileModified: number, size: number }[]>,  // only matching file names; no content read
  read(id): Promise<Snippet>,                          // FolderReadError on any failure
  write(snippet): Promise<{ fileModified: number }>,   // createWritable; returns lastModified read back
  remove(id): Promise<void>,                           // missing file is not an error
}
```
- Test double: an in-memory fake directory handle implementing `values()`, `getFileHandle(name, {create})`, `removeEntry(name)`, `queryPermission()`; file handles with `getFile()` (`lastModified`, `size`, `text()`) and `createWritable()`.

- [ ] **Step 1: Write failing tests:**
  - `list ignores non-matching names, subfolders and non-json files` (Review Focus 1) and returns `fileModified`/`size` without calling `text()` (spy).
  - `read returns the snippet; a corrupt or wrong-version file throws FolderReadError`; a file whose `id` field differs from its file name throws.
  - `write then read round-trips and returns fileModified`; `remove of a missing file does not throw`.
  - `parseSnippetFile rejects`: not JSON, version 2, missing `name`, `tags` not an array.
- [ ] **Step 2: Run** `node --test test/folder.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `parseSnippetFile`, `FolderReadError`, `createFolder`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: folder wrapper for snippet files`.

---

### Task 5: Sync state

**Files:** Create `extension/lib/sync-state.js`; Test `test/sync-state.test.js`

**Interfaces:**
- Produces:
```js
INTERVALS = [{ min: 15, label: "15 min" }, { min: 30, label: "30 min" }, { min: 60, label: "1 h" },
             { min: 120, label: "2 h" }, { min: 360, label: "6 h" }, { min: 720, label: "12 h" }]
defaultState(): { linked: false, folderName: "", intervalMin: 15, status: "ok", lastSync: null,
                  message: "", summary: null, decision: null, synced: {} }
createSyncState(area): { get(): Promise<SyncState>, set(patch): Promise<SyncState>, clear(): Promise<void> }
// stored under chrome.storage.local key "sync"; get() merges over defaultState(); set() shallow-merges.
```

- [ ] **Step 1: Write failing tests:** defaults when empty; `set` merges and `get` returns defaults plus patch; `clear` resets to defaults; `INTERVALS` labels and minutes exactly as in Global Constraints; an unknown stored `intervalMin` falls back to 15.
- [ ] **Step 2: Run** `node --test test/sync-state.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync state`.

---

### Task 6: Engine part A (first link, push, pull)

**Files:** Create `extension/lib/sync-engine.js`; Test `test/sync-engine.test.js` (shared fakes in `test/helpers/sync-fakes.js`)

**Interfaces:**
- Consumes: store (`listMeta`, `get`, `upsertMany`), `Folder` (Task 4), `planSync`, `decideClash`, `createSyncState`.
- Produces:
```js
runSync({ store, folder, state, now = Date.now, resolve = null, firstLink = false }):
  Promise<{ status: "ok"|"paused"|"needs-decision"|"error",
            counts: { pushed, pulled, deletedLocal, deletedFiles, renamed, skipped },
            summary: string | null }>
// resolve: null | "folder" | "local" (Task 8). firstLink: true only when linking.
```
- Behaviour in this task: check `folder.permission()`; list folder; `store.listMeta()`; `planSync`; apply `push` (`store.get` then `folder.write`, then `synced[id] = {modified, fileModified}`), `pull` (`folder.read` then `store.upsertMany`, then `synced[id]`), `conflict` (read the file, newest `modified` wins; equal `modified` keeps local); first link: name clashes between pulled and local snippets use `decideClash` (rename or drop applied to both store and folder); summary text for first link `"12 added from the folder, 30 pushed, 2 renamed"`; `state.set({ status: "ok", lastSync: now(), synced, summary })`.
- Fakes: `fakeFolder(files)` implementing the `Folder` interface in memory (with failure injection), real `createStore` over the in-memory area from `test/store.test.js` (move that helper into `test/helpers`).

- [ ] **Step 1: Write failing tests:**
  - `first link merges: local-only pushed, folder-only pulled, summary counts correct`.
  - `first link with identical same-named snippets keeps one (smaller id) and removes the other from store and folder`.
  - `first link with same name, different content renames the larger id to "Name (2)" on both sides`.
  - `later run pushes a locally edited snippet and pulls a folder-edited one`.
  - `both changed: the newer modified wins; equal modified keeps local`.
  - `synced is updated per snippet after each successful action`.
- [ ] **Step 2: Run** `node --test test/sync-engine.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `runSync`** for these cases (deletes and guard come in Tasks 7 and 8; unhandled action types are left for them).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync engine push, pull, first link`.

---

### Task 7: Engine part B (deletes, failures, permission)

**Files:** Modify `extension/lib/sync-engine.js`; Test `test/sync-engine.test.js`

**Interfaces:** Consumes Task 6. Adds handling of `deleteLocal` (`store.removeMany`), `deleteFile` (`folder.remove`), `forget`.

- [ ] **Step 1: Write failing tests:**
  - `a snippet deleted locally is deleted from the folder; deleted in the folder is deleted locally` (both synced before).
  - `edit beats delete in both directions` (Review Focus 7).
  - `a file that fails to read is skipped, counted in skipped, kept in synced, and retried next run; its local snippet is not deleted` (Review Focus 2).
  - `permission not granted: status paused, nothing read or written, synced unchanged` (Review Focus 6); `permission lost after the first action: remaining actions are not applied and synced reflects only completed actions`.
  - `forget removes the id from synced`.
- [ ] **Step 2: Run** `node --test test/sync-engine.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three action types and the paused/failure handling (a failure while applying one action marks `skipped`, continues, never deletes on failure).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync engine deletes, failure and permission handling`.

---

### Task 8: Engine part C (guard, choices, no echo)

**Files:** Modify `extension/lib/sync-engine.js`; Test `test/sync-engine.test.js`

**Interfaces:** Consumes Task 3 `guard`. When `guard.tripped` and `resolve === null`: apply nothing, `state.set({ status: "needs-decision", decision: { conflicts, threshold, reason } })`, return that status. With `resolve: "folder"`: every `deleteLocal` stays, every `deleteFile` and `conflict` becomes `pull`; with `resolve: "local"`: every `deleteFile` stays, every `deleteLocal` and `conflict` becomes `push`; non-conflict actions run as planned. After applying: `state.set({ status: "ok", decision: null })`.

- [ ] **Step 1: Write failing tests:**
  - `guard tripped: nothing in store, folder or synced changes; status needs-decision; decision carries conflicts and threshold`.
  - `empty folder with synced history trips the guard and deletes nothing` (Review Focus 3).
  - `resolve "folder": a snippet deleted locally comes back, a snippet missing from the folder is deleted locally, new local-only snippets are still pushed`.
  - `resolve "local": a snippet deleted locally stays deleted in the folder, a snippet missing from the folder is re-pushed, new folder-only snippets are still pulled`.
  - `a Restore-sized deletion with resolve "local" mirrors the restore into the folder` (Review Focus 8).
  - `second run directly after a run writes nothing and reads no content` (Review Focus 5; spy on `folder.read`/`write`/`store.get`).
- [ ] **Step 2: Run** `node --test test/sync-engine.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the guard branch and the two resolutions.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync guard and conflict choices`.

---

### Task 9: Service worker wiring

**Files:** Modify `extension/background/sw.js`, `extension/manifest.json`; Create `extension/popup/handle-store.js`; Test `test/manifest.test.js`

**Interfaces:**
- Produces `handle-store.js`: `putHandle(h)`, `getHandle(): Promise<FileSystemDirectoryHandle|undefined>`, `deleteHandle()` (IndexedDB `snippet-sync` / store `h` / key `dir`; same code usable in the service worker and the page).
- `sw.js` runs `runSync` from these triggers: `storage.onChanged` (area local, keys `meta` or starting `c:`, ignoring the `sync` key) with a 2000 ms debounce; alarm `sync` with `periodInMinutes = state.intervalMin` (re-created on `onStartup`/`onInstalled`/interval change when missing); `idle.onStateChanged` to `"active"`; `runtime.onStartup`; message `{type:"sync-now"}`. One run at a time (a second trigger during a run schedules one more run afterwards). When no folder is linked, triggers do nothing.
- Messages (sender id checked): `{type:"sync-now"}` → `runSync`; `{type:"sync-decide", choice:"folder"|"local"|"cancel"}` → `runSync({resolve})` (cancel leaves `needs-decision`); `{type:"sync-set-interval", min}` → state + alarm; `{type:"sync-link"}` (page picked a folder and stored the handle) → `runSync({firstLink:true})`; `{type:"sync-unlink"}` → clear state and handle, clear alarm and badge.
- Badge: `"!"` red while `status` is `paused` or `needs-decision`, cleared when `ok`.
- Manifest: add `"alarms"`, `"idle"` to `permissions`.

- [ ] **Step 1: Write failing test:** `manifest permissions are the six originals plus alarms and idle`; update the existing exact-permissions test accordingly.
- [ ] **Step 2: Run** `node --test test/manifest.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** manifest change, `handle-store.js`, and the `sw.js` triggers, messages and badge.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Manual check** (user): after linking (Task 10), edit a snippet and see the file change within seconds; change the interval; lock/unlock; restart Chrome; revoke permission (badge `!`).
- [ ] **Step 6: Commit** `feat: sync triggers in the service worker`.

---

### Task 10: Sync panel and editor notices

**Files:** Create `extension/lib/editor-sync.js`, `extension/popup/sync-panel.js`; Modify `popup.html`, `popup.css`, `popup.js`; Test `test/editor-sync.test.js`

**Interfaces:**
- Produces `classifyExternalChange(loaded: Meta, current: Meta | undefined, dirty: boolean): "none" | "refresh" | "notice-changed" | "notice-deleted"`: `current` missing: `"notice-deleted"`; `current.modified === loaded.modified`: `"none"`; changed and not `dirty`: `"refresh"`; changed and `dirty`: `"notice-changed"`.
- `mountSyncPanel(rootEl, { getHandle, putHandle, deleteHandle, send, onStatus })`: `send(msg)` posts a runtime message. Renders per spec 6.7: not linked (explanation line + **Choose folder...**: `showDirectoryPicker({ mode: "readwrite", id: "snippet-sync" })`, store handle, `send({type:"sync-link"})`); linked (folder name, status line with last sync time and snippet count, **Sync now**, interval `<select>` from `INTERVALS`, **Unlink** with an inline confirm that says snippets deleted on either side since the last sync come back if re-linked); banners for `paused` (**Re-allow folder** calls `handle.requestPermission({mode:"readwrite"})` from the click, then `sync-now`), `needs-decision` (text: "N snippets conflict (deleted on one side or edited on both). Choose which side wins for these. Everything else is merged." buttons **Folder wins**, **This device wins**, **Cancel**), errors, first-link summary. Re-renders on `chrome.storage.onChanged` for key `sync`.
- `popup.js`: footer **Sync** button (window view only) opens the panel like the Tags panel (unsaved-changes guard). On `storage.onChanged` for `meta`, `classifyExternalChange` for the open snippet: `refresh` reloads the editor; `notice-changed` shows "Changed on another device. Save will overwrite it."; `notice-deleted` shows "Deleted on another device. Save will re-create it." Save on `NOT_FOUND` re-creates via `store.upsertMany` with the same id and `created`, after a duplicate-name check.

- [ ] **Step 1: Write failing tests** for `classifyExternalChange` (all four outcomes).
- [ ] **Step 2: Run** `node --test test/editor-sync.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `editor-sync.js`, then the panel, footer button and `popup.js` handlers.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Manual check** (user): link a folder choosing the persistent option; second profile or device through a real sync tool; delete on one side; edit the same snippet on both; empty the folder (guard banner, both choices); revoke permission (re-allow button); unlink and re-link; edit a snippet while another device changes it.
- [ ] **Step 6: Commit** `feat: sync panel and editor notices`.

---

### Task 11: Docs and cleanup

**Files:** Modify `docs/spec.md`, `README.md`; delete `spikes/fs-permission/` (after the user confirms)

- [ ] **Step 1: README** section "Sync between devices": how it works (folder of `<id>.json`, your own tool moves it), choose **Allow on every visit**, intervals, what the guard asks (choice applies to conflicts only, others merge), name clashes at first link (`Name (2)`), same snippet edited on two devices (newest `modified` wins), unlink/re-link behavior, files are plain text, no encryption, large cloud files may be "online-only" and are retried.
- [ ] **Step 2: Spec:** replace the "Cloud sync" backlog item; add permissions `alarms`, `idle`; add a decision row pointing to the design doc.
- [ ] **Step 3: Run** `npm test`. Expected: PASS.
- [ ] **Step 4: Ask the user** whether to delete `spikes/fs-permission/` and whether the browser-restart check was done; record the result in the design doc section 9.
- [ ] **Step 5: Commit** `docs: folder sync`.

---

## Self-Review

- Spec coverage: goals 2 (triggers) T9; deletes T3/T7; guard T3/T8; first link and clashes T2/T6; files and state T4/T5; UI T10; permissions T9; tag edits sync and editor behavior T1/T10; unlink T9/T10; docs T11.
- Types: `planSync`, `Action`, `Folder`, `runSync`, `createSyncState`, `INTERVALS`, `decideClash`, `classifyExternalChange`, messages `sync-now|sync-decide|sync-set-interval|sync-link|sync-unlink` are named identically wherever used.
- Weak points: SW triggers and the panel are manual-check only (spec 8); folder behavior with real cloud tools (online-only placeholders) can only be seen in use.

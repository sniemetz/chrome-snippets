# Folder sync - design

Status: draft for approval, 2026-11-18. Extends `docs/spec.md` (replaces the "Cloud sync" backlog item). Decisions below were made by the user in conversation on 2026-11-18 unless marked "builder's call".

## 1. Intent

Use the same snippets on several devices without any cloud service built into the extension. The user picks a folder on the local drive; their own tool (Dropbox, Google Drive, Box, Syncthing, ...) moves that folder between devices. The extension keeps the folder and its local storage in step, in both directions, in the background.

## 2. Goals

- One linked folder. Two-way sync between `chrome.storage.local` (the source of truth for the UI) and that folder.
- Runs without any extension page open: after a local change (2 s debounce), periodically (dropdown: 15 min default, 30 min, 1 h, 2 h, 6 h, 12 h), and when the machine wakes from idle or lock, and at browser start. A "Sync now" button forces a run.
- A snippet deleted on one device is deleted on the others.
- Never silently lose data on a mass difference: a guard stops and asks (see 6.4).
- Keep the rule that content is read only to edit, paste, search, export and, new here, to sync a snippet that actually changed.

## 3. Non-goals

- Real-time sync (no file watcher exists; changes are found by listing the folder).
- A conflict UI, merge of text inside one snippet, history/versions.
- More than one folder; syncing settings; mobile; encryption of the files (they are plain JSON; the README says so).
- Handling name clashes between independently created snippets beyond the deterministic rule in 6.5.

## 4. Anti-goals (a failure even if it technically works)

- Deleting or overwriting many snippets because a drive was unmounted, a folder half-synced, or an old copy came back.
- Repeated permission prompts, or sync that works only while an extension page is open.
- A sync run that freezes the browser or reads the whole library on every tick.

## 5. Constraints and what the spike showed (2026-11-18)

- No path text field: the user picks the folder with `showDirectoryPicker()` in an extension page (needs a user gesture; a toolbar popup closes when the OS dialog opens, so pick it in the manager **window**). The handle is stored in IndexedDB (usable from the service worker).
- **Permission:** a plain grant is dropped as soon as the last extension page closes. With the persistent choice at pick time ("Allow on every visit" or similar wording), the service worker kept `granted` for 12+ minutes with all extension pages closed, through idle and locked states. **Not yet verified:** survival across a full browser restart, and long-term expiry (believed about 30 days unused; unverified). The design must tolerate losing the grant.
- The service worker cannot request permission (needs a user gesture in a page). Lost grant = sync pauses until the user clicks "Re-allow folder".
- No file change notification: poll by listing the folder and reading each file's `lastModified` (does not read content). `chrome.alarms` minimum period 30 s.
- New permissions: `alarms`, `idle` (believed to carry no install warning; verify when loading). No host permissions.
- Cloud tools may show "online-only" placeholder files: listing succeeds, reading can be slow or fail.

## 6. Design

### 6.1 Approach (one sensible way)

Per-snippet files in the picked folder, synced by a service-worker engine using the persistent grant. Considered and rejected:
- **One JSON file:** rewrites up to ~80 MB per change, and any two devices editing anything produce a sync-tool conflict copy of the whole library.
- **Page-driven sync only:** cannot run in the background.
- **Drive/Box API:** needs accounts, tokens and new permissions; the user's own tool already does this.

### 6.2 Files in the folder

- `<id>.json`, where `<id>` is the snippet UUID. Content: `{ "version": 1, "id", "name", "content", "tags": [], "created", "modified" }` (same fields as the model in `docs/spec.md` section 6).
- Only files matching `^[0-9a-f-]{36}\.json$` are considered; other files in the folder are ignored and never touched.
- Writes use `createWritable()` (the file is swapped when closed, so a reader never sees a half-written file).

### 6.3 Local sync state (`chrome.storage.local` key `sync`)

`{ linked, folderName, intervalMin, status: "ok" | "paused" | "needs-decision" | "error", lastSync, message, synced: { [id]: { modified, fileModified } } }`.
`synced` records, per snippet, the `modified` and the file's `lastModified` as of the last successful sync. It is what separates "new on this side" from "deleted on the other side". The directory handle lives in IndexedDB (`snippet-sync` / `h` / `dir`).

### 6.4 One sync run (pure planner + thin I/O)

1. Single run at a time. Check `queryPermission({mode:"readwrite"})`. Not granted: status `paused`, badge `!`, stop. Nothing is changed.
2. List matching files and read each `lastModified` (and size). Read `listMeta()` (no content) and `synced`.
3. For each id the planner decides (`planSync`, a pure function, fully unit-tested):

| Local | Folder | In `synced` | Action |
|---|---|---|---|
| yes | no | no | push (new local) |
| no | yes | no | pull (new from folder) |
| yes | yes | yes, neither changed | none |
| yes | yes | local changed only | push |
| yes | yes | folder changed only | pull |
| yes | yes | both changed | newest `modified` wins |
| no | yes | yes | deleted locally: delete the file; **if the file changed since the last sync, pull instead** (an edit beats a delete) |
| yes | no | yes | deleted in the folder: delete locally; **if local changed since, push instead** |
| no | no | yes | forget the id |

4. **Guard.** *Conflicts* are the rows of the table where data could be lost: a deletion (on either side) or a "both changed" overwrite. Plain pushes and pulls (new snippets, edits where only one side changed, tag renames that touch many snippets) are not conflicts. If the conflicts exceed `max(5, 20% of max(local count, folder count))`, or the folder is empty while local is not (or the reverse) and `synced` is non-empty, nothing is applied: status `needs-decision`, badge `!`. The guard does not apply to the first link.
   - **What the user chooses (user decision, 2026-11-18):** the choice applies to the **conflicts only**; everything else is merged as usual. The banner says so, for example: "12 snippets conflict (deleted on one side or edited on both). Choose which side wins for these. Everything else is merged." Buttons: **Folder wins** (for every conflict the folder's state wins: a snippet deleted on this device comes back, a snippet missing from the folder is deleted here, edits on both sides take the folder's version), **This device wins** (the same, toward local), or **Cancel** (stay stopped; the next run re-evaluates). The "empty folder vs non-empty local" case is a set of conflicts too: it lists the same choice. New snippets that exist on only one side are never removed by either choice.
5. **First link** (nothing in `synced`): merge, never destructive. Local-only snippets are pushed, folder-only snippets are pulled. Name clashes follow 6.5. A one-time summary is shown ("12 added from the folder, 30 pushed, 2 renamed").
6. Apply actions one by one. A file that fails to read or parse is skipped, counted, shown ("N files could not be read, will retry") and retried next run; **a read failure is never treated as a deletion**. After each success update `synced[id]`.
7. Pulling writes local storage through `store` (new methods that keep `id`, `created`, `modified` as given), which fires `storage.onChanged` and so schedules another run; that run finds nothing to do because `synced` matches.

### 6.4a Changes needed in the existing code (builder's calls, from the reviewer's findings)

- `store.renameTag` and `store.deleteTag` must set `modified` (now) on every snippet they change, so that tag edits sync. Update their tests.
- Import and Restore produce deletions and many pushes; a Restore with far fewer snippets is expected to trigger the guard ("This device wins" is the answer that mirrors the restore).
- **Editor vs background pulls:** if a pull changes or deletes the snippet open in the manager: no unsaved edits, the editor refreshes silently; with unsaved edits they stay and a notice reads "Changed on another device. Save will overwrite it."; if it was deleted, Save re-creates it (`update` on a missing id falls back to `add` with the same id).
- **Unlink / re-link / different folder:** always a fresh first link (`synced` cleared). The merge deletes nothing, but snippets deleted on either side since the last sync come back. The Unlink confirmation and the README say so.

### 6.5 Name clashes (same name, different id, case-insensitive)

Realistic mainly at first link (e.g. both devices imported the same export, which assigns new ids). Deterministic, so both devices reach the same result:
- Identical content: same snippet. Keep the one with the smaller `id`, delete the other (locally and its file).
- Different content: keep both; the one with the larger `id` is renamed `Name (2)` (next free number). The rename bumps its `modified`.
The same rule applies later if a pull would create a clash. Beyond that, clashes between independently created snippets are not handled (README says what happens).

### 6.6 Triggers

`storage.onChanged` (keys `meta` or `c:*`) with a 2 s debounce; an alarm every `intervalMin`; `idle.onStateChanged` to `active` (wake or unlock); `runtime.onStartup`; the "Sync now" button. Alarms are re-created on startup if missing.

### 6.7 UI (manager window only)

Footer gets a **Sync** button next to Data and Tags; it opens a panel in the right wrapper:

```
Sync
Folder:  spike-test      [Choose folder...]  [Unlink]
Status:  Synced 14:32 - 412 snippets         [Sync now]
Check every: [15 min v]      (15 min, 30 min, 1 h, 2 h, 6 h, 12 h)
```
- Not linked: one explanation line ("Pick a folder your sync tool keeps in sync across devices. When Chrome asks, choose 'Allow on every visit'.") and **Choose folder...**.
- `paused`: banner "Folder access must be re-allowed" + **Re-allow folder** (calls `requestPermission` from the click).
- `needs-decision`: the banner from 6.4. Errors: one-line message.
- **Unlink** removes the handle and the sync state; local snippets and the folder files stay as they are.
- The toolbar icon shows badge `!` while `paused` or `needs-decision`.

### 6.8 Files to add or change (suggested; builder may split differently)

- `lib/sync-plan.js` (pure `planSync`, guard, name-clash rule), `lib/sync-engine.js` (run: I/O through a folder interface, state), `lib/folder.js` (File System Access wrapper behind an interface so tests use a fake), `lib/store.js` (`upsertMany`, `removeMany`, verbatim writes), `background/sw.js` (triggers, badge), `popup/sync-panel.js` + footer button, manifest (`alarms`, `idle`), README, `docs/spec.md`.

## 7. Left to the builder

Lock mechanism for single run; exact text of messages; badge colors; how to batch writes; how the picker prompt wording is described if Chrome's differs; whether `sync` state needs a version field; unit-test fixtures.

## 8. Testing

- `planSync` and the name-clash rule: table-driven unit tests for every row of 6.4 plus first link, guard thresholds, edit-beats-delete both ways, deterministic clash results from both devices' point of view.
- Engine with a fake folder: read failure is not a deletion; partial failure keeps `synced` correct; permission lost mid-run leaves everything unchanged; no echo loop.
- Manual (user): pick folder with the persistent choice, two profiles or two machines through a real sync tool, delete on one device, edit the same snippet on both, unmount/empty the folder (guard), revoke permission (paused), browser restart.

## 9. Open items

- **Browser-restart survival (tested 2026-11-18): the grant does NOT survive a full Chrome restart.** After restart the badge shows `!` and the Sync panel shows "Folder access must be re-allowed". The persistent choice ("Allow on every visit") is offered on that re-allow prompt, not on the first pick (first pick shows only Allow / Don't allow). So one "Re-allow folder" click is needed per browser restart; with "every visit" chosen, the grant then lasts while the browser runs (spike: 12+ min with all pages closed, idle, locked).
- Spike `spikes/fs-permission/` removed (2026-11-18).

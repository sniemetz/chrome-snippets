# Snippet Saver v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome MV3 extension that saves text snippets (name, tags), searches them, and pastes them into editable fields.

**Architecture:** Pure logic in `extension/lib/*.js` (ES modules, tested with `node --test`). One manager page (`popup/`) serves toolbar popup and popup window. Service worker owns menus, commands, window handling, and injects a self-contained palette function with `scripting.executeScript`. No content scripts, no host permissions.

**Tech Stack:** Vanilla JS (ES modules), Manifest V3, `node --test`. No dependencies, no build step.

**Spec:** `docs/spec.md` (decision numbers `#n` below refer to its table). Mockups in `docs/mockup/`.

## Global Constraints

- Permissions exactly: `contextMenus`, `storage`, `unlimitedStorage`, `activeTab`, `scripting`, `clipboardWrite`. No host permissions. No content scripts.
- Manager size fixed 600 x 445 px, layout never moves (#5, 5.1).
- Storage in `chrome.storage.local` is **split** (user decision, 2026-11-16, reversing the earlier plain-array choice because of large snippets): key `meta` = array of `{id,name,tags,preview,created,modified}`; one key `c:<id>` per snippet content. All access through `lib/store.js` (#1). The page (palette) and the manager list never load all content.
- Snippet shape: `{ id, name, content, tags: string[], created, modified }`; times are epoch ms (6).
- Names: required, unique case-insensitive, no overwrite; content required; no max length (#6).
- List order: name, case-insensitive; row = name + first 60 chars of content, newlines as spaces (#8).
- Search: case-insensitive substring on name, content, tags; 200 ms debounce; AND with tag filter (#7).
- Export file `snippets-YYYY-MM-DD.json`, body `{ "version": 1, "snippets": [{name, content, tags, created, modified}] }` (#9).
- Status line text: `"N added, M skipped"`. Restore confirm: `"Replace X snippets with Y from file?"` with Cancel, Replace (#10, #11).
- Placeholder text: `"Select a snippet or click New"`. Toast: `"Copied. Press Ctrl+V"`.
- No `confirm()`/`alert()`; all confirmations inline. Light and dark via `prefers-color-scheme` (#16).
- Commands: `_execute_action` and `open-palette` ("Open paste palette"), no default keys (#13).
- Do not build backlog items (sync, tag registry, CSV, MRU, click-point palette).
- Commit messages: plain, no attribution lines (user preference).

## Plan decisions to confirm (not fixed by the spec)

- Selection for "Add as snippet" is passed via `storage.session` key `pendingNew` (`{content}`), not a URL parameter (selections can be long).
- Names and tags are trimmed. Whitespace-only is empty.
- Import and Restore both validate the whole file first. Invalid file changes nothing.
- Palette in an iframe: injected with `frameIds: [info.frameId]` for the menu; the keyboard command targets the top frame only.

## Review Focus

1. Import file with duplicate names inside itself (case-insensitive): first wins, rest counted as skipped. (Task 5)
2. Name or tag with surrounding whitespace or whitespace-only: trimmed; whitespace-only rejected. (Tasks 2, 4)
3. Malformed import file (not JSON, wrong `version`, `snippets` not array, entry missing `name`/`content`, `tags` not array): rejected, store unchanged. (Task 5)
4. Search query with regex characters (`.*(`): treated literally. (Task 3)
5. Paste on a page with no focused editable field, or a restricted page: no throw, no stuck backdrop. (Tasks 8, 9, manual)

---

## File Structure

| File | Responsibility |
|---|---|
| `extension/manifest.json` | MV3 manifest, permissions, commands, action |
| `extension/icons/` | generated placeholder PNGs 16/32/48/128 |
| `scripts/make-icons.js` | generates icons (zlib, no deps) |
| `extension/lib/tags.js` | tag normalisation and derivation |
| `extension/lib/filter.js` | sort, filter, preview |
| `extension/lib/store.js` | storage access, validation, CRUD |
| `extension/lib/importExport.js` | file format, validation, merge |
| `extension/lib/overlay.js` | self-contained `openPalette(snippets)` injected into pages |
| `extension/popup/popup.html/.css/.js` | manager UI |
| `extension/popup/data-menu.js` | Export / Import / Restore UI |
| `extension/background/sw.js` | menus, commands, window handling, injection |
| `test/*.test.js` | one per lib module + icons + manifest |

---

### Task 1: Manifest and icons

**Files:**
- Create: `extension/manifest.json`, `scripts/make-icons.js`, `extension/icons/icon{16,32,48,128}.png`
- Test: `test/manifest.test.js`

**Interfaces:**
- Produces: manifest with `background.service_worker = "background/sw.js"` (`type: "module"`), `action.default_popup = "popup/popup.html"`, icons map, command `open-palette`.

- [ ] **Step 1: Write failing tests** in `test/manifest.test.js`:
  - `permissions` deep-equals the six in Global Constraints; no `host_permissions`, no `content_scripts`.
  - `commands._execute_action` and `commands["open-palette"]` exist, neither has `suggested_key`.
  - each of `icon{16,32,48,128}.png` exists, starts with PNG signature `89 50 4E 47`, IHDR width/height equal the size.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (files missing).
- [ ] **Step 3: Write `extension/manifest.json`** (`manifest_version: 3`, name "Snippet Saver", `minimum_chrome_version: "88"`, action, background, commands, icons).
- [ ] **Step 4: Write `scripts/make-icons.js`**: draws a flat rounded square with a "{ }"-like mark (any simple shape) into RGBA, encodes PNG with `zlib.deflateSync` and CRC32, writes the four sizes. Run `node scripts/make-icons.js`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: manifest and placeholder icons`.

---

### Task 2: tags.js

**Files:** Create `extension/lib/tags.js`; Test `test/tags.test.js`

**Interfaces:**
- Produces:
  - `normalizeTags(input: string[], known: string[]): string[]` — trim, drop empty, dedupe case-insensitively (first occurrence wins), reuse spelling from `known` when a case-insensitive match exists (#2).
  - `allTags(snippets: Snippet[]): string[]` — unique, sorted case-insensitively.

- [ ] **Step 1: Write failing tests:**
  - `normalizeTags([" Work ", "", "  "], [])` → `["Work"]`
  - `normalizeTags(["work"], ["Work"])` → `["Work"]`
  - `normalizeTags(["a", "A"], [])` → `["a"]`
  - `allTags([{tags:["b","A"]},{tags:["a"]}])` → `["A","b"]` (first-seen spelling kept)
- [ ] **Step 2: Run** `node --test test/tags.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: tag normalisation`.

---

### Task 3: filter.js

**Files:** Create `extension/lib/filter.js`; Test `test/filter.test.js`

**Interfaces:**
- Produces:
  - `sortSnippets(snippets): Snippet[]` — new array, by name case-insensitive (#8).
  - `filterSnippets(snippets, { query = "", tag = "" }): Snippet[]` — result sorted; empty query/tag = no constraint; tag match case-insensitive; query is a literal substring on name, content, tags (#7).
  - `preview(content: string, max = 60): string` — newlines (`\r\n`, `\n`) → single space, first `max` chars.

- [ ] **Step 1: Write failing tests:**
  - sorting `["b","A","c"]` → A, b, c.
  - query `"FOO"` matches content `"a foo b"`; matches tag `"foo"`; matches name.
  - query `".*("` matches only a snippet containing that literal text, no throw (Review Focus 4).
  - query + tag combine as AND.
  - `preview("a\nb\r\nc")` → `"a b c"`; 100-char content → length 60.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `includes` on lowercased strings (no RegExp).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sort, filter, preview`.

---

### Task 4: store.js

**Files:** Create `extension/lib/store.js`; Test `test/store.test.js`

**Interfaces:**
- Consumes: `normalizeTags`, `allTags` from `tags.js`.
- Produces `createStore(area = chrome.storage.local, { now = Date.now, uuid = () => crypto.randomUUID() } = {})` returning:
  - `list(): Promise<Snippet[]>`
  - `get(id): Promise<Snippet | undefined>`
  - `add({name, content, tags}): Promise<Snippet>`
  - `update(id, {name, content, tags}): Promise<Snippet>` — keeps `id`, `created`; sets `modified`.
  - `remove(id): Promise<void>`
  - `replaceAll(snippets: Snippet[]): Promise<void>` — raw set, no validation (caller validated).
  - `addMany(snippets: Snippet[]): Promise<void>` — raw append (caller merged).
- Errors: `class StoreError extends Error { code }` with codes `NAME_REQUIRED`, `CONTENT_REQUIRED`, `DUPLICATE_NAME`, `NOT_FOUND`.
- Test double: in-memory `area` with async `get(key)`/`set(obj)`.

- [ ] **Step 1: Write failing tests:**
  - `add` trims name, stores tags normalised against existing tags, sets `created === modified === now()`.
  - `add({name:"   ", content:"x"})` rejects `NAME_REQUIRED`; `content:""` rejects `CONTENT_REQUIRED`.
  - `add` with name `"Foo"` after `"foo"` rejects `DUPLICATE_NAME`.
  - `update` of self with unchanged name succeeds; update to another snippet's name (different case) rejects `DUPLICATE_NAME`; unknown id rejects `NOT_FOUND`.
  - `update` changes `modified`, not `created`.
  - `remove` removes; `list` empty array when key absent.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (single key `snippets`, read-modify-write).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: snippet store`.

---

### Task 5: importExport.js

**Files:** Create `extension/lib/importExport.js`; Test `test/importExport.test.js`

**Interfaces:**
- Consumes: `normalizeTags`; `Snippet` shape.
- Produces:
  - `exportJson(snippets): string` — pretty JSON per #9, only the five fields (no `id`).
  - `exportFilename(date: Date): string` — `snippets-YYYY-MM-DD.json`, local date.
  - `parseFile(text: string): { ok: true, snippets: {name,content,tags,created,modified}[] } | { ok: false, error: string }` — rejects per Review Focus 3. Missing `created`/`modified` allowed (filled with 0 → caller uses now). Names trimmed; entries with empty name/content → file invalid.
  - `mergeAdditive(existing: Snippet[], incoming, { now, uuid }): { snippets: Snippet[], added: number, skipped: number }` — `snippets` is the full new list; skips case-insensitive name matches including duplicates inside `incoming` (first wins); assigns `id`; normalises tags against existing.
  - `statusLine(added, skipped): string` → `"N added, M skipped"`.
  - `restoreList(incoming, { now, uuid }): Snippet[]` — ids assigned, tags normalised among themselves, duplicate names inside file first-wins.

- [ ] **Step 1: Write failing tests:**
  - round trip: `parseFile(exportJson(x))` equals x minus ids.
  - `exportFilename(new Date(2026, 10, 16))` → `"snippets-2026-11-16.json"`.
  - `parseFile` rejects: `"nope"`, `{"version":2,"snippets":[]}`, `{"version":1,"snippets":{}}`, entry without `content`, entry with `tags:"x"`. Each returns `ok:false`.
  - `parseFile` accepts `{"version":1,"snippets":[]}`.
  - `mergeAdditive` with existing `Foo`, incoming `foo`, `Bar`, `BAR` → added 1, skipped 3 (Review Focus 1); `statusLine(1,3)` → `"1 added, 3 skipped"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: import/export logic`.

---

### Task 6: Manager UI (list, search, editor)

**Files:** Create `extension/popup/popup.html`, `popup.css`, `popup.js`

**Interfaces:**
- Consumes: `createStore`, `StoreError`, `filterSnippets`, `preview`, `allTags`, `normalizeTags`.
- Produces: page reads `storage.session.pendingNew` on load and on `storage.session.onChanged` (consumed in Task 9). When `pendingNew` is present: show "Add snippet" heading, empty form, content prefilled, focus Name, Cancel replaces Close; clear the key after reading. Also listens to `storage.local.onChanged` and re-renders the list (#18).

Layout per spec 5.1 and `docs/mockup/snippets_main.png`: top bar (title, search, tag dropdown, Data button slot, Close), left column (New + list), right pane (Name, tag chips + `<datalist>`, Content), bottom (Delete, Copy, Save). Body `width:600px;height:445px`, overflow inside panes.

- [ ] **Step 1: Write `popup.html` + `popup.css`**: tokens for light on `:root`, dark under `@media (prefers-color-scheme: dark)`; `color-scheme: light dark`.
- [ ] **Step 2: Write `popup.js`**:
  - list rendering from `filterSnippets`; search input debounced 200 ms; tag dropdown from `allTags`.
  - right pane hidden until selection or New; otherwise placeholder `"Select a snippet or click New"`.
  - Save → `store.add`/`update`; `StoreError` codes map to inline messages next to Name/Content (`DUPLICATE_NAME`: "A snippet with this name exists").
  - Delete → inline "Delete? Cancel / Delete" row. Copy → `navigator.clipboard.writeText(content)`.
  - Unsaved edits when selecting another row or New: inline "Discard changes? Keep editing / Discard".
  - Close → `window.close()`.
- [ ] **Step 3: Manual check** (user): load unpacked at `chrome://extensions`, click toolbar icon: add, edit, duplicate-name error, delete confirm, search, tag filter, dark theme, size does not shift. Record result in the task notes.
- [ ] **Step 4: Commit** `feat: manager UI`.

---

### Task 7: Data menu (Export / Import / Restore)

**Files:** Create `extension/popup/data-menu.js`; Modify `popup.html`, `popup.js` (mount point only)

**Interfaces:**
- Consumes: `exportJson`, `exportFilename`, `parseFile`, `mergeAdditive`, `restoreList`, `statusLine`; `store.list/addMany/replaceAll`.
- Produces: `mountDataMenu(rootEl, store, { onStatus(text) })`.

- [ ] **Step 1: Implement** a "Data" button left of Close opening a menu: Export (Blob + temporary `<a download>`, works in extension pages), Import (hidden `<input type=file accept=.json>`), Restore (same input).
- [ ] **Step 2: Import flow**: `parseFile` → on error show message, nothing changes; else `mergeAdditive` → `addMany` → show `statusLine`.
- [ ] **Step 3: Restore flow**: `parseFile` first; invalid → message only. Valid → inline `"Replace X snippets with Y from file?"` with Cancel, Replace → `replaceAll(restoreList(...))`.
- [ ] **Step 4: Manual check** (user): export, wipe via Restore of an empty file, restore the export; import the same file → `"0 added, N skipped"`; import garbage → message, no change.
- [ ] **Step 5: Commit** `feat: data menu`.

---

### Task 8: Paste palette overlay

**Files:** Create `extension/lib/overlay.js`; Test `test/overlay.test.js` (pure helpers only)

**Interfaces:**
- Produces: `openPalette(snippets: Snippet[]): void` — **fully self-contained** (no imports, no closures; includes its own sort/preview/filter copies). Injected by `scripting.executeScript({ func: openPalette, args: [snippets] })`.
- Behavior (#14, #15): saves `document.activeElement` and selection/caret on open; Shadow DOM host with dim backdrop; search input focused, focus trapped; list sorted like the manager; ArrowUp/Down move, Enter/click inserts, Esc/backdrop click closes and removes host. Insert: restore focus and caret, `document.execCommand('insertText', false, content)`; if it returns false or the value is unchanged, `navigator.clipboard.writeText` and show toast `"Copied. Press Ctrl+V"` (2 s). No focused editable field: clipboard + toast, no throw (Review Focus 5). Selected text is replaced by insert.
- Test hook: `export const __internals = { sort, preview }` is NOT used by the injected function; instead test that `openPalette.toString()` contains no reference to any module-level identifier: evaluate it with `new Function("return " + openPalette.toString())()` in a stub-less scope and assert it throws no `ReferenceError` when called with a minimal fake `document` global.

- [ ] **Step 1: Write failing test** for the self-containment check above (fake `document`, `window`, `navigator` globals via `globalThis`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `openPalette`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Manual check** (user; covers the spec's open verification): on a test page with `input`, `textarea`, `contenteditable` and an iframe field, open the palette via Task 9 and insert; note which targets fall back to clipboard. Record results in `docs/spec.md` section 9. If inserts prove unreliable, raise as an inflection point (fallback to copy-only, #14).
- [ ] **Step 6: Commit** `feat: paste palette overlay`.

---

### Task 9: Service worker

**Files:** Create `extension/background/sw.js`

**Interfaces:**
- Consumes: `createStore`, `openPalette`.
- Produces: no exports. Behavior:
  - `runtime.onInstalled`: create three menus (#4): `paste` (`contexts:["editable"]`, "Paste snippet"), `add` (`["selection"]`, "Add as snippet"), `open` (`["all"]`, "Open Snippets").
  - `paste` click → inject `openPalette` into `tab.id`, `frameIds:[info.frameId]`, args `[await store.list()]`.
  - `add` click → `storage.session.set({ pendingNew: { content: info.selectionText } })`, then open-or-focus manager.
  - `open` click → open-or-focus manager.
  - `commands.onCommand("open-palette")` → inject into active tab top frame; on injection error (restricted page) do nothing visible (log only).
  - `openManager()`: if `windowId` in `storage.session` and `windows.get` succeeds → `windows.update(id,{focused:true})`; else `windows.create({type:"popup", url:"popup/popup.html", width:600, height:445})` and store the id (sizes include chrome; adjust after manual check). `windows.onRemoved` clears the key (#17).

- [ ] **Step 1: Implement** as above; menus registered in `onInstalled` only.
- [ ] **Step 2: Manual check** (user, reload extension first): right-click editable → Paste snippet; selection → Add as snippet opens/refocuses the one window with content prefilled; "Open Snippets" focuses it; keyboard command bound at `chrome://extensions/shortcuts` opens palette; restricted page (`chrome://extensions`) does nothing bad.
- [ ] **Step 3: Commit** `feat: service worker menus, commands, window handling`.

---

### Task 10: README and wrap-up

**Files:** Modify `README.md`

- [ ] **Step 1:** Document load-unpacked, shortcuts setup, incognito note ("off until enabled"), min Chrome 88, reload-after-`background/`-change gotcha, `npm test` scope (`lib/` only).
- [ ] **Step 2: Run** `npm test`. Expected: all PASS.
- [ ] **Step 3: Update** `docs/spec.md` section 9: storage shape = array; insert-verification results.
- [ ] **Step 4: Commit** `docs: README and spec updates`.

---

## Self-Review

- Spec coverage: #1 T4; #2 T2; #3, #14, #15 T8/T9; #4 T9; #5 T6/T9; #6 T4; #7, #8 T3; #9–#12 T5/T7; #13 T1/T9; #16 T6; #17 T9/T6; #18 T6; #19 T1; #20 T10. 5.2 in T6/T9; 5.3 in T8.
- Types: `createStore`, `StoreError`, `normalizeTags`, `allTags`, `filterSnippets`, `preview`, `parseFile`, `mergeAdditive`, `restoreList`, `statusLine`, `openPalette` used consistently.
- Known weak point: overlay DOM behavior and menu/window behavior are manual-check only (spec 8: user does UI checks).

---

### Task 11 (added after Task 10): large-library redesign

Reason: user expects ~400 snippets, some 50-200 kB. Sending all content to pages and loading it in the popup does not scale.

- `store.js`: split keys; add `listMeta()`, `search({query, tag})` (name/tags from meta, content scanned in chunks of 25 keys, nothing held), `get(id)` full; `list()` stays full (export only). `add`/`update` return full snippet.
- Palette: SW sends `{id,name,tags,preview}[]` on open; typing sends `{type:"snippet-search", query}` to the SW; pick sends `{type:"snippet-content", id}`.
- Manager: list from `listMeta`/`search`; full snippet loaded by `get(id)` on select. Import merges against `listMeta()`, appends with `addMany`.
- Review fixes (Chrome min 102; overlay test no longer vacuous; shadow-DOM active element; pending confirm reset; "Add as snippet" content kept on "Keep editing"; Save error status; menu position; palette small guards).

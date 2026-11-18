# Snippet Saver - spec

Status: ready for implementation planning. Working name: "Snippet Saver" (placeholder).
Mockups: `docs/mockup/snippets_main.png`, `snippets_rightclick_no_selection.png`, `snippets_rightclick_selection.png`.

## 1. Goal

Chrome extension (Manifest V3). Save text snippets with name and tags. Search them. Paste them into any editable field.

## 2. Scope

### In v1
- Manager UI (list, search, tag filter, edit, add, delete, copy).
- Context menu: Paste snippet, Add as snippet, Open Snippets.
- In-page paste palette (search, click or Enter to insert).
- Export, Import (additive), Restore (wipe, then add). JSON only.
- Keyboard commands (unbound by default).
- Light and dark theme (system).

### Backlog (not in v1)
- Cloud sync. Preferred path: Drive via `identity` + `drive.file` scope. Open point: no native folder picker; Google Picker needs a sandboxed or hosted page. Local storage stays the source of truth. Other options checked: `storage.sync` (102,400 B total, 8,192 B per item: too small), `bookmarks` (permission warning, unverified size limits), File System Access (no official Drive client on Linux).
- Keyboard navigation in the toolbar popup (search autofocus, focusable rows, Enter copies).
- Tag registry and options page (configured tag dropdown). A simple tag manager (rename, delete) is done in the window view.
- CSV export/import.
- Most-recently-used ordering (needs `lastUsed` field).
- Palette at click point (needs broad content script; permission warning).
- Chrome Web Store submission.

## 3. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Storage | `chrome.storage.local` with `unlimitedStorage`. Split keys: `meta` (array of id, name, tags, preview, created, modified) + one `c:<id>` key per content. Content is read only to edit, paste or search (and for Export). Behind one module `lib/store.js`. |
| 2 | Tags | `tags: string[]`. Chips input with autocomplete (`<datalist>` or equivalent) from existing tags. Tag list derived from snippets, no registry. Case-insensitive match on save reuses the existing spelling. |
| 3 | Paste flyout | In-page overlay built with `scripting.executeScript` and Shadow DOM. Permission `activeTab`. Not available on restricted pages (`chrome://`, Web Store), the Chrome location bar or DevTools panels (extension menus do not appear there). In a cross-origin iframe without host permission the palette opens on the top page instead and picking copies ("Copied. Press Ctrl+V"); with the opt-in site permission it inserts directly. Failures flash a `!` badge on the toolbar icon. |
| 4 | Menu items | "Paste snippet": `contexts: ["editable"]`. "Add as snippet": `contexts: ["selection"]`. "Open Snippets": `contexts: ["all"]`. Selection inside a field shows both Add and Paste. Paste over a selection replaces it. |
| 5 | Manager surface | `chrome.windows.create({type: "popup"})`, about 600 x 445 px, same HTML page as the toolbar popup but a different view (`?view=window`; see 5.1). Selection passed via `storage.session` (`pendingNew`). Toolbar icon uses `default_popup` (list + editor view, no Data/Tags). |
| 6 | Name rules | Name required. Unique, case-insensitive. Inline error on duplicate, no overwrite. Content required. No max length; saving above 20 kB asks for confirmation ("Save anyway"), never blocks. |
| 7 | Search | Case-insensitive substring on name, content, tags. 200 ms debounce. No minimum length. Tag dropdown filter in manager combines with search (AND). |
| 8 | List | Alphabetical by name, case-insensitive. Row = name + first 60 chars of content, newlines as spaces. Palette uses the same order. |
| 9 | Export/import | JSON: `{ "version": 1, "snippets": [{ "name", "content", "tags", "created", "modified" }] }`. File `snippets-YYYY-MM-DD.json`. |
| 10 | Import | Additive. Skip names that exist (case-insensitive). Status line: "N added, M skipped". |
| 11 | Restore | Validate file first. Invalid file changes nothing. Inline confirm: "Replace X snippets with Y from file?" (Cancel, Replace). Then wipe and add. |
| 12 | Data UI | "Data" menu button in top bar, left of Close: Export, Import, Restore. |
| 13 | Commands | `_execute_action` and "Open paste palette". No default keys. User binds at `chrome://extensions/shortcuts`. Palette command inserts into the focused field. |
| 14 | Paste failure | Insert at caret (`execCommand('insertText')`). If it returns false or the value is unchanged: copy to clipboard, toast "Copied. Press Ctrl+V". Needs `clipboardWrite`. Fallback to copy-only if inserts prove unreliable. |
| 15 | Palette position | Centered in viewport, on a dim modal backdrop. Backdrop click or Esc closes. Focus trapped in search box. Target field focus and caret saved on open, restored before insert. No content script, no host permissions. |
| 16 | Theme | Follow `prefers-color-scheme`. Light and dark tokens for manager and palette. |
| 17 | Window handling | One manager window. "Open Snippets" focuses it. `windowId` kept in `storage.session`. "Add as snippet" reuses it. Unsaved edits: inline prompt (discard or keep editing). |
| 18 | Live data | Manager and palette read storage on open. Manager listens to `storage.onChanged`. |
| 19 | Icons | Placeholder icon made in the build. Sizes 16, 32, 48, 128 in `extension/icons/`. |
| 20 | Distribution | Load unpacked. |

## 4. Permissions

`contextMenus`, `storage`, `unlimitedStorage`, `activeTab`, `scripting`, `clipboardWrite`. No required host permissions, no install warning. No content scripts.

Optional (opt-in per site, `optional_host_permissions`: `https://*/*`, `http://*/*`): requested at runtime for one origin through the menu item "Allow Snippets on this site". Needed to insert into a cross-origin iframe (UI rework, 2026-11-17: Workfront inside an Adobe wrapper). Remove a granted site at `chrome://extensions` > Snippet Saver > Details > Site access.

## 5. UI

### 5.1 Manager (mockup `snippets_main.png`, with deltas; reworked 2026-11-17)
Two views of the same page (`popup/popup.html`):
- **Window view** (`?view=window`, opened by "Open Snippets", "Add as snippet" and the toolbar popup's "Open manager" button), fixed 600 x 445 px content. Layout never moves.
- **Toolbar popup** (no parameter, 600 x 445 px): the same list and editor as the window (updated 2026-11-18; the content of one snippet is loaded on select, never the library). No Data or Tags buttons and no Close; an "Open manager" button replaces them, because a toolbar popup closes on focus loss (file picker, click outside) and would drop unsaved edits during Import/Restore. The window opens centered on the last focused browser window (a service worker cannot read the mouse position). The row Copy button copies and closes the popup.

Window view layout:
- Top bar: title, search box, tag filter dropdown, Close.
- Left wrapper: snippet list (name + preview) with New and Delete under it. Each row has a small Copy button (both views): it copies the content and shows "Copied!" on the button (the toolbar popup then closes); a click on the rest of the row selects the snippet.
- Right wrapper (editable; same border/radius/padding as the left): Name, tag chips, "Content" label with a "Copy content" link (copies the text area's current text, same "Copied!" feedback), text area, Save under the text area.
- Save is disabled until name, tags or content differ from what was loaded (New mode: enabled once anything is typed; prefilled "Add as snippet" is enabled).
- Footer (below the wrappers): Data menu (opens upward) and Tags buttons on the left; inline confirmations (Delete, unsaved changes) on the right. No `confirm()` dialog.
- Tag manager (footer "Tags", opens in the right wrapper): every tag with its snippet count; Rename (merges into an existing tag, case-insensitive, existing spelling wins; case-only change allowed) and Delete (inline confirm), applied to all snippets. Reads and writes metadata only.
- Right wrapper content hidden until a snippet or "New" is selected. Placeholder text: "Select a snippet or click New". (User-confirmed.)

### 5.2 Add as snippet (mockup `snippets_rightclick_selection.png`)
- Opens the manager with an empty "New" form. Content = selection. Cursor in Name.
- Heading "Add snippet". Cancel replaces Close.

### 5.3 Paste palette (mockup `snippets_rightclick_no_selection.png`)
- Search box (focused), list of snippets (name + preview).
- Arrow keys move, Enter or click inserts, Esc closes.
- Opens with names, tags and 60-char previews only. Typing asks the service worker to search (name, tags, content). Picking fetches that one snippet's content.

## 6. Data model

```json
{ "id": "uuid", "name": "string", "content": "string", "tags": ["string"], "created": 0, "modified": 0 }
```

- Stored split (decided 2026-11-16, for libraries of ~400 snippets of up to 200 kB): `meta` = `[{ id, name, tags, preview, created, modified }]`, `c:<id>` = content. The export format (decision 9) is unchanged.

## 7. Structure

- `extension/manifest.json`
- `extension/background/sw.js`: menus, commands, window handling, injection.
- `extension/popup/`: manager page.
- `extension/lib/`: `store.js`, `filter.js`, `tags.js`, `importExport.js`, overlay code.
- `test/`: `node --test` on `lib/`.

## 8. Testing and gotchas

- `npm test` covers `lib/` logic: store, filter, tags, import/export validation. The user does UI checks.
- After changes to `background/` or `lib/` used by the service worker: reload the extension on `chrome://extensions`.
- The Chrome tool cannot open `chrome://` pages.
- Incognito: off until the user enables it. Note in README.
- Min Chrome: 102 (`chrome.storage.session`).

## 9. Open points for the plan

- ~~Storage shape~~: decided, plain array.
- OPEN, manual check pending: verify `execCommand('insertText')` on `input`, `textarea`, `contenteditable`, and iframes (`frameId` from the menu click).

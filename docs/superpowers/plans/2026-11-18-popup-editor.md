# Popup editor, row copy icon, centered manager window

> **For agentic workers:** Use superpowers:executing-plans. Small change: tasks below, each ends with `npm test` green.

**Goal:** Toolbar popup shows list + editor again (content loaded one snippet at a time, no bulk read). Each row has a small Copy button (both views). Manager window opens centered on the browser window you were in.

**Spec:** `docs/spec.md` 5.1 (updated in Task 3). Supersedes the "list-only toolbar popup" decision of 2026-11-17.

## User decisions (2026-11-18)
- Copy button on every row in both views; the name is plain text again. Toolbar popup: copy + close. Window: copy, button flashes "Copied!".
- Toolbar popup: list, search, tag filter, editor, Save. No Data or Tags buttons; an "Open manager" button replaces them (a toolbar popup closes on focus loss: file picker, click outside).
- Manager window opens centered (mouse position is not available to a service worker, so: centered on the last focused normal browser window).

## Global constraints
- Content is read only to edit, paste, search, export (unchanged). Opening the editor reads one snippet via `store.get(id)`.
- Toolbar popup size 600 x 445 (same as window content). Window outer 616 x 490.
- Plain commit messages, no attribution.

## Task 1: Centered window position
- Create `extension/lib/position.js`: `centeredPosition(parent: {left,top,width,height}|undefined, size: {width,height}): {left?: number, top?: number}`. Centered in `parent`; never left/above `parent.left/top` (a small parent aligns to its top-left); returns `{}` when `parent` lacks numeric fields.
- Test `test/position.test.js`: centered; offset parent; smaller parent aligns to top-left; missing/NaN fields give `{}`.
- Modify `extension/background/sw.js` `openManager`: `chrome.windows.getLastFocused({ windowTypes: ["normal"] })` (try/catch) then `chrome.windows.create({ ..., ...centeredPosition(parent, WIN) })`.

## Task 2: Popup editor + row Copy button
- `popup.js`: rows render `[name + preview] [Copy]`; Copy calls `copyWithFeedback(store, id, button, { closeAfter: view === "toolbar" })` and stops propagation; the name is no longer a copy target; the toolbar-only row click handler goes away (row click selects in both views).
- Toolbar view boots the editor like the window; `pendingNew`, Data menu and tag manager stay window-only.
- `popup.html/.css`: `#openMgrBtn` moves to the footer and shows only in the toolbar view; toolbar hides `#closeBtn`, `#dataMount`, `#tagsBtn`; drop the toolbar width/hide-right rules.

## Task 3: Docs
- `docs/spec.md` 5.1 and README: toolbar popup = list + editor, Copy button per row, centered window.

## Review focus
1. Copy button click must not also select the row. 2. Toolbar popup must not consume `pendingNew`. 3. A parent window smaller than the manager must not push it off-screen.

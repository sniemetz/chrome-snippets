# Snippet Saver

Chrome extension (Manifest V3). Save, search, and paste text snippets.

- Spec: `docs/spec.md`
- Plan: `docs/superpowers/plans/2026-11-16-snippet-saver-v1.md`
- Mockups: `docs/mockup/`

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked" and select the `extension/` folder.

## Use

- Toolbar icon: popup with the list and the editor (same 600 x 445 layout as the window). Each row has a **Copy** button: it copies the content, shows "Copied!" and closes the popup. Click the rest of the row to edit. The popup has no Data or Tags buttons: **Open manager** opens the full window (centered on your browser window). A toolbar popup closes when it loses focus, so unsaved edits there are lost.
- Manager window (right-click > **Open Snippets**, or "Open manager"): same list with a **Copy** button per row (copies and shows "Copied!"). **Copy content** copies the text in the editor. **Save** is enabled only after a change.
- **Data** menu (bottom left): Export, Import (adds, skips existing names), Restore (replaces all). **Tags**: rename or delete a tag across all snippets.
- Right-click in an editable field: **Paste snippet** (opens the palette).
- Right-click in an editable field inside an iframe from another site (for example Workfront inside a wrapper page): Paste snippet opens the palette on the top page and copies the snippet; press Ctrl+V. For direct insertion right-click inside that iframe and use **Allow Snippets on this site** once (the item appears only inside iframes) (Chrome asks for permission for that site only). Remove it at `chrome://extensions` > Snippet Saver > Details > Site access.
- Right-click on selected text: **Add as snippet**.
- A `!` on the toolbar icon for 3 seconds means the action failed on this page.

## Keyboard shortcuts

No default keys. Bind them at `chrome://extensions/shortcuts`:

- "Open Snippets" (toolbar action)
- "Open paste palette" (inserts into the focused field)

## Notes

- Minimum Chrome: 102 (Manifest V3, `chrome.storage.session`).
- Large libraries: the list and the palette only load names, tags and a 60-char preview. Full content is read to edit, paste or search a snippet. Export reads everything.
- Incognito: off until you enable it for this extension on `chrome://extensions`.
- The palette cannot open on restricted pages (`chrome://`, Chrome Web Store). Extension context menus do not appear in the Chrome location bar or in DevTools panels; use the toolbar popup there (click a snippet, then Ctrl+V).
- After you change files in `extension/background/` or `extension/lib/`, reload the extension on `chrome://extensions`.
- Icons are placeholders: `node scripts/make-icons.js`.

## Tests

`npm test` runs `node --test` on `extension/lib/` logic and the manifest. UI is checked by hand.

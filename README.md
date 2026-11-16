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

- Toolbar icon: opens the manager (list, search, tag filter, edit).
- Right-click in an editable field: **Paste snippet** (opens the palette).
- Right-click on selected text: **Add as snippet**.
- Right-click anywhere: **Open Snippets** (manager window).
- **Data** menu in the manager: Export, Import (adds, skips existing names), Restore (replaces all).

## Keyboard shortcuts

No default keys. Bind them at `chrome://extensions/shortcuts`:

- "Open Snippets" (toolbar action)
- "Open paste palette" (inserts into the focused field)

## Notes

- Minimum Chrome: 88 (Manifest V3).
- Incognito: off until you enable it for this extension on `chrome://extensions`.
- The palette cannot open on restricted pages (`chrome://`, Chrome Web Store).
- After you change files in `extension/background/` or `extension/lib/`, reload the extension on `chrome://extensions`.
- Icons are placeholders: `node scripts/make-icons.js`.

## Tests

`npm test` runs `node --test` on `extension/lib/` logic and the manifest. UI is checked by hand.

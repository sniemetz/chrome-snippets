# ChromeSnippets

Chrome extension (Manifest V3). Save, search, and paste text snippets.

- License: MIT (`LICENSE`)
- Privacy policy: [`docs/privacy-policy.md`](docs/privacy-policy.md) (no tracking; data stays on your device unless you turn on sync)
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
- Right-click in an editable field inside an iframe from another site (for example Workfront inside a wrapper page): Paste snippet opens the palette on the top page and copies the snippet; press Ctrl+V. For direct insertion right-click inside that iframe and use **Allow Snippets on this site** once (the item appears only inside iframes) (Chrome asks for permission for that site only). Remove it at `chrome://extensions` > ChromeSnippets > Details > Site access.
- Right-click on selected text: **Add as snippet**.
- A `!` on the toolbar icon for 3 seconds means the action failed on this page.

## Sync between devices

Sync uses **Dropbox** (sign-in, nothing to install). Turn it on in manager > **Sync**. Design: `docs/superpowers/specs/2026-11-21-cloud-sync-design.md`.

- Sign-in (nothing to configure): manager > **Sync** > **Sign in to Dropbox...**, a small Dropbox window opens next to the manager: allow access, copy the code it shows, paste it into the field in the Sync panel, click **Connect**. No redirect URI; PKCE with an embedded public app key. If the manager closes meanwhile, reopen manager > Sync: the paste field comes back (the pending sign-in is kept for 15 min, then start again). In the toolbar popup, the paused "Sign in" button opens the manager directly on Sync for the paste step. A network error keeps the field: press **Connect** again.
- Scopes: `files.content.read`, `files.content.write`, `files.metadata.read`, `account_info.read`.
- Storage: Dropbox app folder only (`Apps/<your app>/`), one `/<uuid>.json` per snippet (plain text, not encrypted).
- Tokens: `chrome.storage.local` key `dropboxAuth`. Sync keeps running after Chrome restarts, no prompt.
- Schedule, merge, conflict and guard rules: see below.
- Access revoked or token invalid: banner "Sign in to Dropbox again" with a **Sign in** button.
- **Unlink** revokes the token at Dropbox and clears it locally. Your snippets and the Dropbox files stay. Linking again is a fresh first link: snippets deleted on either side since the last sync come back.
- Limits:
  - A wrong or expired code needs a new **Sign in to Dropbox...** (each code works once, with the verifier of the latest attempt).
  - Switching Dropbox account by signing in again is not supported: **Unlink** first.

### Developer setup (own Dropbox app only)

Not needed for normal use: the extension ships with a public app key (`extension/lib/dropbox-config.js`). To use your own app:

1. At dropbox.com/developers/apps: **Create app** > Scoped access > **App folder**. Enable the 4 scopes above and click **Submit** BEFORE the first sign-in (changing scopes later invalidates tokens). Keep **Allow public clients (PKCE)** enabled. Add NO redirect URI.
2. Put the **App key** into `DROPBOX_APP_KEY` in `extension/lib/dropbox-config.js` (public client id, no secret) and reload the extension.

- Manual checklist: `docs/superpowers/plans/2026-11-21-dropbox-sync-manual-checklist.md`.

### How sync behaves

- Sync runs in the background: 2 seconds after a change, every 15 min (choose 15 min, 30 min, 1 h, 2 h, 6 h or 12 h), when the computer wakes or unlocks, at browser start, and on **Sync now**.
- Deleting a snippet on one device deletes it on the others. If you edit a snippet on one device and delete it on another, the edit wins.
- Safety guard: if many snippets would be deleted or overwritten at once (more than 5 and 20%, or Dropbox is suddenly empty), sync stops and asks: **Dropbox wins**, **This device wins** or **Cancel**. The choice applies only to the conflicting snippets; everything else is merged. Restoring a smaller library triggers this; **This device wins** mirrors the restore into Dropbox. Export files contain snippet ids, so restoring your own export keeps the same snippets (older export files still restore, with new ids).
- First link merges: nothing is deleted. Two snippets with the same name and the same content become one. Same name, different content: both stay, one is renamed `Name (2)` (the same one on every device).
- The same snippet edited on two devices: the newest edit wins.
- A `!` on the toolbar icon means sync needs you: **Sign in** (access lost) or a conflict decision.

## Keyboard shortcuts

No default keys. Bind them at `chrome://extensions/shortcuts`:

- "Open Snippets" (toolbar action)
- "Open paste palette" (inserts into the focused field)

## Notes

- Minimum Chrome: 102 (Manifest V3, `chrome.storage.session`).
- Large libraries: the list and the palette only load names, tags and a 60-char preview. Full content is read to edit, paste or search a snippet. Export reads everything.
- Snippet size: no hard limit. Saving a snippet above 20 kB asks "Save anyway?" (large snippets slow search, sync and pasting). Import accepts any size.
- Incognito: off until you enable it for this extension on `chrome://extensions`.
- The palette cannot open on restricted pages (`chrome://`, Chrome Web Store). Extension context menus do not appear in the Chrome location bar or in DevTools panels; use the toolbar popup there (click a snippet, then Ctrl+V).
- After you change files in `extension/background/` or `extension/lib/`, reload the extension on `chrome://extensions`.
- Icons are placeholders: `node scripts/make-icons.js`.

## Tests

`npm test` runs `node --test` on `extension/lib/` logic and the manifest. UI is checked by hand.

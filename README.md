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

## Sync between devices

Two backends: **Dropbox** (sign-in, no local folder) and **Folder** (your own tool syncs a local folder). Pick one in manager > **Sync**. Design: `docs/superpowers/specs/2026-11-21-cloud-sync-design.md`.

### Dropbox

- Sign-in: **Sync** > **Sign in to Dropbox**. Uses `chrome.identity.launchWebAuthFlow` (PKCE + `state`). Scopes: `files.content.read`, `files.content.write`, `files.metadata.read`, `account_info.read`.
- Storage: Dropbox app folder only (`Apps/<your app>/`), one `/<uuid>.json` per snippet (plain text, not encrypted).
- Tokens: `chrome.storage.local` key `dropboxAuth`. Sync keeps running after Chrome restarts, no prompt.
- Same schedule, merge, conflict and guard rules as the folder backend (below).
- Access revoked or token invalid: banner "Sign in to Dropbox again" with a **Sign in** button.
- **Unlink** with the Dropbox backend linked revokes the token at Dropbox and clears it locally. Switching to a folder link also revokes and clears it. Snippets and remote files stay.
- Limits:
  - The sign-in window blocks the sync queue while it is open.
  - Switching Dropbox account by signing in again is not supported: **Unlink** first.

#### Dropbox setup

1. At dropbox.com/developers/apps: **Create app** > Scoped access > **App folder**. Enable the 4 scopes above (Permissions tab) and click **Submit** BEFORE the first sign-in (changing scopes later invalidates tokens: sign in again). Keep **Allow public clients (PKCE)** enabled (default).
2. Copy the **App key** into `extension/lib/dropbox-config.js` (`DROPBOX_APP_KEY`). It is a public client id; there is no secret.
3. Reload the extension at `chrome://extensions`.
4. Open the manager > **Sync**. Copy the shown redirect URI (`https://<extension-id>.chromiumapp.org/`).
5. Paste it into the Dropbox app > Settings > **Redirect URIs** > Add.
6. Click **Sign in to Dropbox**.

- The extension ID differs per machine and install (no manifest `key`). Repeat steps 4-5 for each one.
- Manual checklist: `docs/superpowers/plans/2026-11-21-dropbox-sync-manual-checklist.md`.

### Folder

- Open the manager window > **Sync** > **Choose folder...** Pick a folder that your own tool (Dropbox, Google Drive, Box, Syncthing, ...) keeps in sync across devices. The first prompt only offers Allow / Don't allow. After every Chrome restart the permission is gone: the toolbar icon shows `!` and the toolbar popup opens on a **Re-allow folder** button (also in the Sync panel). Choose **Allow on every visit** there; sync then keeps running in the background until the next restart.
- The folder gets one `<id>.json` file per snippet (plain text, not encrypted). Other files in the folder are ignored. Cloud tools may keep files "online-only"; those are retried on the next run.
- Sync runs in the background: 2 seconds after a change, every 15 min (choose 15 min, 30 min, 1 h, 2 h, 6 h or 12 h), when the computer wakes or unlocks, at browser start, and on **Sync now**.
- Deleting a snippet on one device deletes it on the others. If you edit a snippet on one device and delete it on another, the edit wins.
- Safety guard: if many snippets would be deleted or overwritten at once (more than 5 and 20%, or the folder is suddenly empty), sync stops and asks: **Folder wins**, **This device wins** or **Cancel**. The choice applies only to the conflicting snippets; everything else is merged. Restoring a smaller library triggers this; **This device wins** mirrors the restore into the folder. Export files now contain snippet ids, so restoring your own export keeps the same snippets (older export files still restore, with new ids).
- First link merges: nothing is deleted. Two snippets with the same name and the same content become one. Same name, different content: both stay, one is renamed `Name (2)` (the same one on every device).
- The same snippet edited on two devices: the newest edit wins.
- A `!` on the toolbar icon means sync needs you: **Re-allow folder** (permission lost) or a conflict decision.
- **Unlink** keeps your snippets and the folder files. Linking again (the same or another folder) is a fresh first link: snippets deleted on either side since the last sync come back.

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

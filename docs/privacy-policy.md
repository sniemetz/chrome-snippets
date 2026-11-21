# Privacy Policy – ChromeSnippets

_Last updated: 2026-11-21_

ChromeSnippets is a Chrome extension that stores text snippets and pastes them into editable fields. It has no servers of its own. The developer does not receive, collect, or have access to your data.

## What the extension stores

- **Your snippets** (name, content, tags, timestamps) and your settings. They are stored in your browser in `chrome.storage.local` and stay on your device.
- If you turn on **Dropbox sync**: a Dropbox access token and refresh token, and the name of your Dropbox account (display name or email) so the extension can detect a different account. They are stored in `chrome.storage.local` on your device only.

## What leaves your device

Only if you turn on Dropbox sync:

- Your snippets are uploaded to, and downloaded from, **your own Dropbox account**, in the app folder `Apps/<app name>/` (one JSON file per snippet). The extension talks directly to `api.dropboxapi.com` and `content.dropboxapi.com`.
- When you sign in or the access token is renewed, the extension talks to Dropbox's OAuth endpoint with the extension's public app key. No developer-operated server is involved.
- Dropbox processes this data under its own terms and privacy policy: <https://www.dropbox.com/privacy>.

Without sync, nothing is sent anywhere. The extension has no analytics, telemetry, advertising, crash reporting, or remote code.

## Permissions and why

- `storage`, `unlimitedStorage`: keep your snippets locally.
- `contextMenus`, `activeTab`, `scripting`, `clipboardWrite`: add selected text as a snippet, open the paste palette, and paste or copy a snippet. The extension reads page content only when you invoke it (for example "Add as snippet" on a selection), and only the text you select.
- Optional site access (`https://*/*`, `http://*/*`): requested per site, only if you choose "Allow Snippets on this site" to paste directly inside an embedded frame. You can remove it at `chrome://extensions`.
- `alarms`, `idle`: schedule background sync and run it when the computer wakes.
- Dropbox hosts (`api.dropboxapi.com`, `content.dropboxapi.com`): sync with your Dropbox.

## Sharing and sale

The developer does not sell, share, or transfer your data to anyone. Data goes to Dropbox only because you chose to sync, and only into your own account.

## Your control

- **Unlink** in manager > Sync revokes the Dropbox token and deletes it from the extension. Your snippets and the files already in your Dropbox remain; delete them in Dropbox if you want them gone.
- You can also remove the app at <https://www.dropbox.com/account/connected_apps>.
- Removing the extension deletes all locally stored data.
- **Export** (Data menu) gives you your snippets as a file at any time.

## Security

Tokens are stored in the extension's local storage, which other websites cannot read. Anyone with access to your browser profile on your device can use them, so protect your device account. Sign-in uses OAuth with PKCE; the extension never sees your Dropbox password.

## Children

The extension is not directed at children and collects no personal data.

## Changes

Changes to this policy are published in this file with a new "Last updated" date.

## Contact

Open an issue in the project repository: <https://github.com/sniemetz/chrome-snippets/issues>.

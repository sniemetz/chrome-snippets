# Dropbox sync - manual verification checklist

Owner: the user. Not run yet; nothing here is automated.

## Setup
- [ ] Register the Dropbox app (scoped, App folder, 4 scopes) and enter the key in `extension/lib/dropbox-config.js`
- [ ] Reload the extension
- [ ] Add the redirect URI shown in manager > Sync to the Dropbox app
- [ ] Sign in
- [ ] Account name appears after sign-in (real Dropbox accepts `users/get_current_account` with no body and no Content-Type)

## Sync
- [ ] Sync two machines (add, edit, delete a snippet on each; both converge)
- [ ] Close and restart Chrome
- [ ] Wait two sync intervals: sync runs, no prompt

## Auth edge cases
- [ ] Revoke access in Dropbox: sign-in banner appears; "Sign in" recovers
- [ ] Sign-in window lifetime in the MV3 worker: leave the window open for a while, then finish; sign-in completes
- [ ] Cancel the sign-in while already linked: link stays intact
- [ ] Unlink: the app is gone from Dropbox's connected-apps list

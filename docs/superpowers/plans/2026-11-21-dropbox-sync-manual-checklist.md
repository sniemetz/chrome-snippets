# Dropbox sync - manual verification checklist

Owner: the user. Not run yet; nothing here is automated.

## Setup
- [ ] Reload the extension (nothing to configure: the app key is embedded, no redirect URI)
- [ ] Code-paste sign-in works: Sync > Sign in to Dropbox..., allow, copy the code, paste, Connect
- [ ] Account name appears after sign-in (real Dropbox accepts `users/get_current_account` with no body and no Content-Type)

## Sync
- [ ] Sync two machines (add, edit, delete a snippet on each; both converge)
- [ ] Close and restart Chrome
- [ ] Wait two sync intervals: sync runs, no prompt

## Auth edge cases
- [ ] Revoke access in Dropbox: sign-in banner appears; "Sign in" recovers
- [ ] Popup closed mid-flow (Dropbox tab opened), reopened manager > Sync: pasting the code still works within 15 min; after 15 min it says to start again
- [ ] Cancel at the paste step: back to the buttons; while already linked, link stays intact
- [ ] Wrong or expired code: error shown, nothing linked; a new Sign in works
- [ ] Re-sign-in (after revoke) with the same account: OK
- [ ] Re-sign-in with a different account: refused, sync stays paused
- [ ] Toolbar popup with paused Dropbox: "Sign in" opens the manager window, which has the paste field
- [ ] Unlink: the app is gone from Dropbox's connected-apps list

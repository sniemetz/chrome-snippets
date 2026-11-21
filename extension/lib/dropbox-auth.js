const KEY = "dropboxAuth";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const REVOKE_URL = "https://api.dropboxapi.com/2/auth/token/revoke";
const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const SKEW_MS = 60_000;

export class DropboxAuthError extends Error {
  constructor(message) { super(message); this.name = "DropboxAuthError"; }
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function makePkce(random = crypto) {
  const verifier = b64url(random.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function buildAuthUrl({ appKey, redirectUri, challenge }) {
  const p = new URLSearchParams({
    client_id: appKey, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256", token_access_type: "offline", redirect_uri: redirectUri,
  });
  return `${AUTH_URL}?${p}`;
}

export function createDropboxAuth({ fetch, area, appKey, now = Date.now }) {
  const load = async () => (await area.get(KEY))[KEY] || null;
  const save = (v) => area.set({ [KEY]: v });

  async function post(params) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { res, body };
  }

  async function signIn(code, verifier, redirectUri) {
    const { res, body } = await post({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: appKey, redirect_uri: redirectUri,
    });
    if (!res.ok || !body || !body.access_token || !body.refresh_token) {
      throw new Error(`Dropbox sign-in failed (${res.status}${body && body.error ? " " + body.error : ""})`);
    }
    await save({ refresh: body.refresh_token, access: body.access_token,
      expiresAt: now() + body.expires_in * 1000, invalid: false });
  }

  async function accessToken({ force } = {}) {
    const st = await load();
    if (!st || !st.refresh || st.invalid) throw new DropboxAuthError("Dropbox is not linked");
    if (!force && st.access && st.expiresAt - now() >= SKEW_MS) return st.access;
    const { res, body } = await post({ grant_type: "refresh_token", refresh_token: st.refresh, client_id: appKey });
    if (!res.ok) {
      if (body && body.error === "invalid_grant") {
        await save({ ...st, invalid: true });
        throw new DropboxAuthError("Dropbox authorization is no longer valid");
      }
      throw new Error(`Dropbox token refresh failed (${res.status})`);
    }
    await save({ ...st, access: body.access_token, expiresAt: now() + body.expires_in * 1000, invalid: false });
    return body.access_token;
  }

  async function hasLink() {
    const st = await load();
    return !!(st && st.refresh && !st.invalid);
  }
  async function isInvalid() {
    const st = await load();
    return !!(st && st.invalid);
  }
  async function clear() { await area.remove(KEY); }
  async function revoke() {
    try {
      const st = await load();
      if (!st || !st.access) return;
      await fetch(REVOKE_URL, { method: "POST", headers: { Authorization: `Bearer ${st.access}` } });
    } catch { /* best effort */ }
  }

  return { signIn, accessToken, hasLink, isInvalid, clear, revoke };
}

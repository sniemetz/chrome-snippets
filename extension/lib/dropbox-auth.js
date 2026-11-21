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

// No redirect_uri: Dropbox shows the user an access code to paste back. The code is exchanged with our
// stored PKCE verifier, so a foreign code fails the exchange and no `state` is needed.
export function buildAuthUrl({ appKey, challenge }) {
  const p = new URLSearchParams({
    client_id: appKey, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256", token_access_type: "offline",
  });
  return `${AUTH_URL}?${p}`;
}

function validToken(b) {
  return !!b && typeof b.access_token === "string" && b.access_token !== ""
    && typeof b.expires_in === "number" && Number.isFinite(b.expires_in);
}

export function createDropboxAuth({ fetch, area, appKey, now = Date.now }) {
  const load = async () => (await area.get(KEY))[KEY] || null;
  const save = (v) => area.set({ [KEY]: v });

  async function post(params) {
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });
    } catch (err) {
      // No answer from Dropbox (offline etc.): callers may keep a pending sign-in and retry.
      if (err && typeof err === "object") err.network = true;
      throw err;
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { res, body };
  }

  async function signIn(code, verifier) {
    const { res, body } = await post({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: appKey,
    });
    if (!res.ok) throw new Error(`Dropbox sign-in failed (${res.status}${body && body.error ? " " + body.error : ""})`);
    if (!validToken(body) || typeof body.refresh_token !== "string" || !body.refresh_token) {
      throw new Error("Dropbox token sign-in bad response");
    }
    await save({ refresh: body.refresh_token, access: body.access_token,
      expiresAt: now() + body.expires_in * 1000, invalid: false });
  }

  // Call only inside sw.js's `exclusive` queue: no in-flight dedupe by design (concurrent refreshes would race).
  async function accessToken({ force } = {}) {
    const st = await load();
    if (!st || !st.refresh || st.invalid) throw new DropboxAuthError("Dropbox is not linked");
    if (!force && st.access && st.expiresAt - now() >= SKEW_MS) return st.access;
    const { res, body } = await post({ grant_type: "refresh_token", refresh_token: st.refresh, client_id: appKey });
    if (!res.ok) {
      if (body && body.error === "invalid_grant") {
        await save({ invalid: true });
        throw new DropboxAuthError("Dropbox authorization is no longer valid");
      }
      throw new Error(`Dropbox token refresh failed (${res.status})`);
    }
    if (!validToken(body)) throw new Error("Dropbox token refresh bad response");
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
      let token = null;
      try { token = await accessToken({ force: true }); } catch { /* fall back to stored token */ }
      if (!token) { const st = await load(); token = st && st.access; }
      if (!token) return;
      await fetch(REVOKE_URL, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch { /* best effort */ }
  }

  return { signIn, accessToken, hasLink, isInvalid, clear, revoke };
}

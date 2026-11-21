import { test } from "node:test";
import assert from "node:assert/strict";
import { makePkce, buildAuthUrl, createDropboxAuth, DropboxAuthError } from "../extension/lib/dropbox-auth.js";
import { DROPBOX_APP_KEY } from "../extension/lib/dropbox-config.js";
import { memArea } from "./helpers/mem-area.js";

// RFC 7636 appendix B vector
const RFC_BYTES = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
  22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function fakeFetch(...responses) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  f.calls = calls;
  return f;
}
function setup(fetch, now = () => 1_000_000) {
  const area = memArea();
  return { area, auth: createDropboxAuth({ fetch, area, appKey: "KEY", now }) };
}
const tok = (o = {}) => ({ refresh: "R", access: "A", expiresAt: 1_000_000 + 3_600_000, invalid: false, ...o });

test("config app key is an empty string", () => assert.equal(DROPBOX_APP_KEY, ""));

test("makePkce matches RFC 7636 vector", async () => {
  const random = { getRandomValues: (a) => { a.set(RFC_BYTES); return a; } };
  assert.deepEqual(await makePkce(random), { verifier: RFC_VERIFIER, challenge: RFC_CHALLENGE });
});
test("makePkce default: verifier 43-128 base64url, challenge no padding", async () => {
  const { verifier, challenge } = await makePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
});

test("buildAuthUrl contains every param", () => {
  const u = new URL(buildAuthUrl({ appKey: "KEY", redirectUri: "https://x.chromiumapp.org/cb", challenge: "CH" }));
  assert.equal(u.origin + u.pathname, "https://www.dropbox.com/oauth2/authorize");
  const p = u.searchParams;
  assert.equal(p.get("client_id"), "KEY");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("code_challenge"), "CH");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(p.get("token_access_type"), "offline");
  assert.equal(p.get("redirect_uri"), "https://x.chromiumapp.org/cb");
});

test("signIn posts code exchange and stores tokens", async () => {
  const f = fakeFetch(json(200, { access_token: "A1", refresh_token: "R1", expires_in: 14400 }));
  const { area, auth } = setup(f);
  await auth.signIn("CODE", "VER", "https://r/cb");
  assert.equal(f.calls[0].url, "https://api.dropboxapi.com/oauth2/token");
  assert.equal(f.calls[0].init.method, "POST");
  assert.deepEqual(f.calls[0].body, { grant_type: "authorization_code", code: "CODE", code_verifier: "VER",
    client_id: "KEY", redirect_uri: "https://r/cb" });
  assert.deepEqual(area.data.dropboxAuth, { refresh: "R1", access: "A1", expiresAt: 1_000_000 + 14400 * 1000, invalid: false });
  assert.equal(await auth.hasLink(), true);
});
test("signIn failure throws and stores nothing", async () => {
  const f = fakeFetch(json(400, { error: "invalid_grant" }));
  const { area, auth } = setup(f);
  await assert.rejects(auth.signIn("C", "V", "r"), Error);
  assert.equal(area.data.dropboxAuth, undefined);
});

test("accessToken returns cached token without fetch while valid", async () => {
  const f = fakeFetch();
  const { area, auth } = setup(f);
  await area.set({ dropboxAuth: tok() });
  assert.equal(await auth.accessToken(), "A");
  assert.equal(f.calls.length, 0);
});
test("accessToken refreshes within 60s of expiry", async () => {
  const f = fakeFetch(json(200, { access_token: "A2", expires_in: 14400 }));
  const { area, auth } = setup(f);
  await area.set({ dropboxAuth: tok({ expiresAt: 1_000_000 + 59_000 }) });
  assert.equal(await auth.accessToken(), "A2");
  assert.deepEqual(f.calls[0].body, { grant_type: "refresh_token", refresh_token: "R", client_id: "KEY" });
  assert.deepEqual(area.data.dropboxAuth, { refresh: "R", access: "A2", expiresAt: 1_000_000 + 14400 * 1000, invalid: false });
});
test("accessToken({ force }) refreshes even when valid", async () => {
  const f = fakeFetch(json(200, { access_token: "A3", expires_in: 14400 }));
  const { area, auth } = setup(f);
  await area.set({ dropboxAuth: tok() });
  assert.equal(await auth.accessToken({ force: true }), "A3");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.grant_type, "refresh_token");
});
test("invalid_grant marks invalid and throws DropboxAuthError", async () => {
  const f = fakeFetch(json(400, { error: "invalid_grant", error_description: "refresh token is invalid or revoked" }));
  const { area, auth } = setup(f);
  await area.set({ dropboxAuth: tok({ expiresAt: 0 }) });
  await assert.rejects(auth.accessToken(), DropboxAuthError);
  assert.equal(area.data.dropboxAuth.invalid, true);
  assert.equal(await auth.isInvalid(), true);
  assert.equal(await auth.hasLink(), false);
});
test("network error on refresh throws plain Error, invalid stays false", async () => {
  const f = fakeFetch(new TypeError("offline"));
  const { area, auth } = setup(f);
  await area.set({ dropboxAuth: tok({ expiresAt: 0 }) });
  await assert.rejects(auth.accessToken(), (e) => e instanceof Error && !(e instanceof DropboxAuthError));
  assert.equal(area.data.dropboxAuth.invalid, false);
  assert.equal(await auth.hasLink(), true);
});
test("accessToken without link throws DropboxAuthError", async () => {
  const { auth } = setup(fakeFetch());
  await assert.rejects(auth.accessToken(), DropboxAuthError);
});

test("hasLink/isInvalid false when nothing stored", async () => {
  const { auth } = setup(fakeFetch());
  assert.equal(await auth.hasLink(), false);
  assert.equal(await auth.isInvalid(), false);
});
test("clear removes dropboxAuth", async () => {
  const { area, auth } = setup(fakeFetch());
  await area.set({ dropboxAuth: tok() });
  await auth.clear();
  assert.equal(area.data.dropboxAuth, undefined);
});
test("revoke posts bearer to revoke endpoint", async () => {
  const f = fakeFetch(json(200, {}));
  const { area, auth } = setup(f);
  await area.set({ dropboxAuth: tok() });
  await auth.revoke();
  assert.equal(f.calls[0].url, "https://api.dropboxapi.com/2/auth/token/revoke");
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer A");
});
test("revoke swallows errors", async () => {
  const { area, auth } = setup(fakeFetch(new Error("boom")));
  await area.set({ dropboxAuth: tok() });
  await auth.revoke();
  const { auth: a2 } = setup(fakeFetch());
  await a2.revoke(); // no link
});

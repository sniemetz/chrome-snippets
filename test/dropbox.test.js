import { test } from "node:test";
import assert from "node:assert/strict";
import { createDropbox } from "../extension/lib/dropbox.js";
import { createDropboxAuth, DropboxAuthError } from "../extension/lib/dropbox-auth.js";
import { FolderReadError } from "../extension/lib/folder.js";
import { fakeDropbox } from "./helpers/fake-dropbox.js";
import { memArea } from "./helpers/mem-area.js";

const uid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const snip = (n, o = {}) => ({ id: uid(n), name: `n${n}`, content: `c${n}`, tags: ["t"], created: 1, modified: 2, ...o });

// Auth stub: token follows the fake's current token whenever it is (re)fetched with force.
function setup(opts) {
  const dbx = fakeDropbox(opts);
  let tok = dbx.currentToken();
  const auth = {
    linked: true, forced: 0, authErr: null,
    hasLink: async () => auth.linked,
    accessToken: async ({ force } = {}) => {
      if (auth.authErr) throw auth.authErr;
      if (force) { auth.forced++; tok = dbx.currentToken(); }
      return tok;
    },
  };
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  return { dbx, auth, sleeps, dropbox: createDropbox({ fetch: dbx.fetch, auth, sleep }) };
}

test("pausedMessage", () => assert.equal(setup().dropbox.pausedMessage, "Sign in to Dropbox again"));

test("list pages through has_more and ignores non-<uuid>.json names and folders", async () => {
  const { dbx, dropbox } = setup({ pageSize: 2 });
  for (let i = 1; i <= 5; i++) dbx.put(uid(i), "{}");
  dbx.files.set("/notes.json", { text: "x", server_modified: "2026-01-01T00:00:00Z" });
  dbx.files.set("/" + uid(9) + ".txt", { text: "x", server_modified: "2026-01-01T00:00:00Z" });
  const out = await dropbox.list();
  assert.deepEqual(out.map((f) => f.id).sort(), [1, 2, 3, 4, 5].map(uid));
  assert.ok(dbx.calls.some((c) => c.url.endsWith("/list_folder/continue")));
  assert.deepEqual(JSON.parse(dbx.calls[0].body), { path: "", limit: 2000 });
});

test("list failure throws FolderReadError", async () => {
  const { dbx, dropbox } = setup();
  dbx.failNext(400);
  await assert.rejects(dropbox.list(), FolderReadError);
});

test("write then list returns the same whole-second fileModified", async () => {
  const { dropbox } = setup();
  const { fileModified } = await dropbox.write(snip(1));
  assert.equal(fileModified % 1000, 0);
  const [f] = await dropbox.list();
  assert.equal(f.fileModified, fileModified);
  assert.equal(f.id, uid(1));
});

test("write sends overwrite args, octet-stream and the folder JSON", async () => {
  const { dbx, dropbox } = setup();
  await dropbox.write(snip(1));
  const c = dbx.calls.at(-1);
  assert.deepEqual(c.arg, { path: `/${uid(1)}.json`, mode: "overwrite", mute: true });
  assert.equal(c.body, JSON.stringify({ version: 1, ...snip(1) }, null, 2));
});

test("read round-trips", async () => {
  const { dropbox } = setup();
  await dropbox.write(snip(1));
  assert.deepEqual(await dropbox.read(uid(1)), snip(1));
});

test("read rejects id mismatch, garbage and missing with FolderReadError", async () => {
  const { dbx, dropbox } = setup();
  dbx.put(uid(1), JSON.stringify({ version: 1, ...snip(2) }));
  dbx.put(uid(3), "garbage");
  await assert.rejects(dropbox.read(uid(1)), FolderReadError);
  await assert.rejects(dropbox.read(uid(3)), FolderReadError);
  await assert.rejects(dropbox.read(uid(4)), FolderReadError);
});

test("remove deletes; a missing file is success", async () => {
  const { dbx, dropbox } = setup();
  await dropbox.write(snip(1));
  await dropbox.remove(uid(1));
  assert.equal(dbx.files.size, 0);
  await dropbox.remove(uid(1));
});

test("remove still throws on other errors", async () => {
  const { dbx, dropbox } = setup();
  dbx.failNext(403);
  await assert.rejects(dropbox.remove(uid(1)));
});

test("accountName uses display name, else email", async () => {
  const { dbx, dropbox } = setup();
  assert.equal(await dropbox.accountName(), "Ada");
  dbx.account = { name: {}, email: "a@b.c" };
  assert.equal(await dropbox.accountName(), "a@b.c");
});

test("expired token mid-run: one forced refresh, one retry", async () => {
  const { dbx, auth, dropbox } = setup();
  await dropbox.write(snip(1));
  dbx.expireToken();
  const before = dbx.calls.length;
  assert.equal((await dropbox.list()).length, 1);
  assert.equal(auth.forced, 1);
  assert.equal(dbx.calls.length - before, 2);
});

test("a second 401 throws and does not loop", async () => {
  const { dbx, auth, dropbox } = setup();
  auth.accessToken = async () => "stale";
  await assert.rejects(dropbox.write(snip(1)));
  assert.equal(dbx.calls.length, 2);
});

test("429 waits Retry-After seconds then retries once", async () => {
  const { dbx, sleeps, dropbox } = setup();
  dbx.failNext(429, { "Retry-After": "3" });
  await dropbox.write(snip(1));
  assert.deepEqual(sleeps, [3000]);
  assert.equal(dbx.files.size, 1);
});

test("429 twice throws", async () => {
  const { dbx, dropbox } = setup();
  dbx.failNext(429, { "Retry-After": "1" });
  dbx.failNext(429, { "Retry-After": "1" });
  await assert.rejects(dropbox.write(snip(1)));
});

test("500 is retried once then thrown", async () => {
  const { dbx, dropbox } = setup();
  dbx.failNext(500);
  await dropbox.write(snip(1));
  assert.equal(dbx.calls.length, 2);
  dbx.calls.length = 0;
  dbx.failNext(500); dbx.failNext(500);
  await assert.rejects(dropbox.write(snip(2)));
  assert.equal(dbx.calls.length, 2);
});

test("network failure is retried once then thrown (read -> FolderReadError)", async () => {
  const { dbx, dropbox } = setup();
  dbx.put(uid(1), JSON.stringify({ version: 1, ...snip(1) }));
  dbx.failNext("network");
  assert.equal((await dropbox.read(uid(1))).id, uid(1));
  dbx.failNext("network"); dbx.failNext("network");
  await assert.rejects(dropbox.read(uid(1)), FolderReadError);
});

test("network/5xx failures do not change permission()", async () => {
  const { dbx, dropbox } = setup();
  dbx.failNext(500); dbx.failNext(500);
  await assert.rejects(dropbox.list());
  assert.equal(await dropbox.permission(), "granted");
});

test("DropboxAuthError propagates unchanged from every operation", async () => {
  const { auth, dropbox } = setup();
  const err = new DropboxAuthError("gone");
  auth.authErr = err;
  for (const op of [() => dropbox.list(), () => dropbox.read(uid(1)), () => dropbox.write(snip(1)), () => dropbox.remove(uid(1)), () => dropbox.accountName()]) {
    await assert.rejects(op(), (e) => e === err);
  }
});

test("permission denied after invalid_grant with no network call", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes("oauth2/token")) return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) };
    throw new Error("unexpected");
  };
  const area = memArea();
  await area.set({ dropboxAuth: { refresh: "R", access: "A", expiresAt: 0, invalid: false } });
  const auth = createDropboxAuth({ fetch, area, appKey: "K", now: () => 1e6 });
  const dropbox = createDropbox({ fetch, auth, sleep: async () => {} });
  assert.equal(await dropbox.permission(), "granted");
  await assert.rejects(dropbox.list(), DropboxAuthError);
  const n = calls.length;
  assert.equal(await dropbox.permission(), "denied");
  assert.equal(calls.length, n);
});

test("429 without Retry-After waits the 1 s default", async () => {
  const { dbx, sleeps, dropbox } = setup();
  dbx.failNext(429);
  await dropbox.write(snip(1));
  assert.deepEqual(sleeps, [1000]);
});

test("accountName sends no body and no Content-Type", async () => {
  const { dbx, dropbox } = setup();
  await dropbox.accountName();
  const c = dbx.calls.at(-1);
  assert.equal(c.body, undefined);
  assert.equal(c.contentType, undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSync } from "../extension/lib/sync-engine.js";
import { setup, sn } from "./helpers/sync-fakes.js";
import { createDropbox } from "../extension/lib/dropbox.js";
import { fakeDropbox } from "./helpers/fake-dropbox.js";

const run = (c, o = {}) => runSync({ store: c.store, folder: c.folder, state: c.state, now: c.now, ...o });
const ids = async (store) => (await store.listMeta()).map((m) => m.id).sort();

test("first link merges: local-only pushed, folder-only pulled, summary counts correct", async () => {
  const c = await setup({ local: [sn("l1"), sn("l2")], files: [sn("f1")] });
  const r = await run(c, { firstLink: true });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.counts, { pushed: 2, pulled: 1, deletedLocal: 0, deletedFiles: 0, renamed: 0, skipped: 0 });
  assert.equal(r.summary, "1 added from the folder, 2 pushed");
  assert.deepEqual(await ids(c.store), ["f1", "l1", "l2"]);
  assert.deepEqual([...c.folder.files.keys()].sort(), ["f1", "l1", "l2"]);
  const st = await c.state.get();
  assert.deepEqual(Object.keys(st.synced).sort(), ["f1", "l1", "l2"]);
  assert.equal(st.lastSync, 5000);
  assert.equal(st.status, "ok");
});
test("first link with identical same-named snippets keeps one (smaller id), removes the other from store and folder", async () => {
  const c = await setup({ local: [sn("b2", { name: "Sig", content: "x" })], files: [sn("a1", { name: "sig", content: "x" })] });
  await run(c, { firstLink: true });
  assert.deepEqual(await ids(c.store), ["a1"]);
  assert.deepEqual([...c.folder.files.keys()], ["a1"]);
  assert.deepEqual(Object.keys((await c.state.get()).synced), ["a1"]);
});
test("first link, same name different content: larger id (pulled side) renamed on both sides", async () => {
  const c = await setup({ local: [sn("a1", { name: "Sig", content: "x" })], files: [sn("b2", { name: "Sig", content: "y" })] });
  const r = await run(c, { firstLink: true });
  assert.equal(r.counts.renamed, 1);
  assert.equal(r.summary, "1 added from the folder, 1 pushed, 1 renamed");
  const all = await c.store.list();
  assert.equal(all.find((s) => s.id === "b2").name, "Sig (2)");
  assert.equal(all.find((s) => s.id === "a1").name, "Sig");
  assert.equal(c.folder.files.get("b2").snippet.name, "Sig (2)");
  assert.ok(c.folder.files.get("b2").snippet.modified > 1);
});
test("first link, same name different content: larger id on the local side is renamed", async () => {
  const c = await setup({ local: [sn("b2", { name: "Sig", content: "y" })], files: [sn("a1", { name: "Sig", content: "x" })] });
  await run(c, { firstLink: true });
  const all = await c.store.list();
  assert.equal(all.find((s) => s.id === "b2").name, "Sig (2)");
  assert.equal(all.find((s) => s.id === "a1").name, "Sig");
  assert.equal(c.folder.files.get("b2").snippet.name, "Sig (2)");
});
test("later run pushes a locally edited snippet and pulls a folder-edited one", async () => {
  const c = await setup({ local: [sn("a"), sn("b")] });
  await run(c, { firstLink: true });
  await c.store.update("a", { name: "a", content: "local edit", tags: [] });
  c.folder.put(sn("b", { content: "folder edit", modified: 9000 }));
  const r = await run(c);
  assert.equal(r.counts.pushed, 1);
  assert.equal(r.counts.pulled, 1);
  assert.equal(c.folder.files.get("a").snippet.content, "local edit");
  assert.equal((await c.store.get("b")).content, "folder edit");
  assert.equal((await c.store.get("b")).modified, 9000);
});
test("both changed: the newer modified wins", async () => {
  const c = await setup({ local: [sn("a"), sn("b")] });
  await run(c, { firstLink: true });
  await c.store.update("a", { name: "a", content: "local newer", tags: [] }); // modified ~1000+
  c.folder.put(sn("a", { content: "folder older", modified: 2 }));
  await c.store.upsertMany([sn("b", { content: "local older", modified: 3 })]);
  c.folder.put(sn("b", { content: "folder newer", modified: 4000 }));
  await run(c);
  assert.equal(c.folder.files.get("a").snippet.content, "local newer");
  assert.equal((await c.store.get("b")).content, "folder newer");
});
test("both changed with equal modified keeps local", async () => {
  const c = await setup({ local: [sn("a")] });
  await run(c, { firstLink: true });
  await c.store.upsertMany([sn("a", { content: "L", modified: 77 })]);
  c.folder.put(sn("a", { content: "F", modified: 77 }));
  await run(c);
  assert.equal(c.folder.files.get("a").snippet.content, "L");
  assert.equal((await c.store.get("a")).content, "L");
});
test("synced is updated per snippet: a failure on the third write keeps the first two recorded", async () => {
  const c = await setup({ local: [sn("a"), sn("b"), sn("c")] });
  c.folder.failWriteOn = "c";
  const r = await run(c, { firstLink: true });
  assert.equal(r.status, "ok");
  assert.equal(r.counts.skipped, 1);
  assert.deepEqual(Object.keys((await c.state.get()).synced).sort(), ["a", "b"]);
});

// ---- Task 7: deletes, failures, permission ----
const linked = async (local) => {
  const c = await setup({ local });
  await run(c, { firstLink: true });
  return c;
};

test("a snippet deleted locally is deleted from the folder; deleted in the folder is deleted locally", async () => {
  const c = await linked([sn("a"), sn("b"), sn("c")]);
  await c.store.remove("a");
  c.folder.files.delete("b");
  const r = await run(c);
  assert.deepEqual(r.counts, { ...r.counts, deletedFiles: 1, deletedLocal: 1 });
  assert.deepEqual([...c.folder.files.keys()], ["c"]);
  assert.deepEqual(await ids(c.store), ["c"]);
  assert.deepEqual(Object.keys((await c.state.get()).synced), ["c"]);
});
test("edit beats delete in both directions", async () => {
  const c = await linked([sn("a"), sn("b"), sn("c")]);
  await c.store.remove("a");
  c.folder.put(sn("a", { content: "edited elsewhere", modified: 9000 }));
  await c.store.update("b", { name: "b", content: "edited here", tags: [] });
  c.folder.files.delete("b");
  const r = await run(c);
  assert.equal((await c.store.get("a")).content, "edited elsewhere");
  assert.equal(c.folder.files.get("b").snippet.content, "edited here");
  assert.equal(r.counts.deletedLocal + r.counts.deletedFiles, 0);
});
test("an unreadable file is skipped, counted, kept in synced and retried; its local snippet is not deleted", async () => {
  const c = await linked([sn("a"), sn("b")]);
  const before = (await c.state.get()).synced.a;
  c.folder.put(sn("a", { content: "new", modified: 9000 }), { unreadable: true });
  c.folder.put(sn("x"), { unreadable: true });
  const r = await run(c);
  assert.equal(r.status, "ok");
  assert.equal(r.counts.skipped, 2);
  assert.equal(r.counts.deletedLocal, 0);
  assert.ok(await c.store.get("a"));
  assert.deepEqual((await c.state.get()).synced.a, before);
  assert.match((await c.state.get()).message, /2 files could not be synced/);
  c.folder.files.get("a").unreadable = false;
  c.folder.files.get("x").unreadable = false;
  const r2 = await run(c);
  assert.equal(r2.counts.pulled, 2);
  assert.equal((await c.store.get("a")).content, "new");
  assert.ok(await c.store.get("x"));
});
test("permission not granted: status paused, nothing read or written, synced unchanged", async () => {
  const c = await linked([sn("a")]);
  const before = (await c.state.get()).synced;
  await c.store.update("a", { name: "a", content: "changed", tags: [] });
  c.folder.perm = "prompt";
  c.folder.calls.write.length = 0;
  const r = await run(c);
  assert.equal(r.status, "paused");
  assert.deepEqual(c.folder.calls, { read: [], write: [], remove: [] });
  assert.deepEqual((await c.state.get()).synced, before);
  assert.equal((await c.state.get()).status, "paused");
});
test("permission lost mid-run: remaining actions are not applied; synced reflects completed actions only", async () => {
  const c = await setup({ local: [sn("a"), sn("b"), sn("c")] });
  c.folder.permLostAfter = 2;
  const r = await run(c, { firstLink: true });
  assert.equal(r.status, "paused");
  assert.equal(r.counts.pushed, 1);
  assert.deepEqual(Object.keys((await c.state.get()).synced), ["a"]);
  assert.equal(c.folder.files.size, 1);
});
test("forget removes the id from synced", async () => {
  const c = await linked([sn("a")]);
  await c.state.set({ synced: { ...(await c.state.get()).synced, z: { modified: 1, fileModified: 1 } } });
  await run(c);
  assert.deepEqual(Object.keys((await c.state.get()).synced), ["a"]);
});

// ---- Task 8: guard, choices, no echo ----
const names = (n, p = "s") => Array.from({ length: n }, (_, i) => `${p}${i}`);
const contentKeys = (area) => area.gets.flat().filter((k) => typeof k === "string" && k.startsWith("c:"));
// 10 linked snippets; local loses s0..s5, folder loses s9, plus new n1 (local) and f1 (folder): 7 conflicts > 5.
async function trippedSetup() {
  const c = await linked(names(10).map((i) => sn(i)));
  for (const i of names(6)) await c.store.remove(i);
  c.folder.files.delete("s9");
  await c.store.upsertMany([sn("n1")]);
  c.folder.put(sn("f1"));
  return c;
}

test("guard tripped: nothing changes; status needs-decision; decision carries conflicts and threshold", async () => {
  const c = await linked(names(10).map((i) => sn(i)));
  for (const i of names(6, "s")) c.folder.files.delete(i);
  const syncedBefore = (await c.state.get()).synced;
  const r = await run(c);
  assert.equal(r.status, "needs-decision");
  const st = await c.state.get();
  assert.equal(st.status, "needs-decision");
  assert.deepEqual(st.decision, { conflicts: 6, threshold: 5, reason: "count" });
  assert.deepEqual(st.synced, syncedBefore);
  assert.equal((await c.store.listMeta()).length, 10);
  assert.equal(c.folder.files.size, 4);
});
test("empty folder with synced history trips the guard and deletes nothing", async () => {
  const c = await linked([sn("a"), sn("b")]);
  c.folder.files.clear();
  const r = await run(c);
  assert.equal(r.status, "needs-decision");
  assert.equal((await c.state.get()).decision.reason, "folder-empty");
  assert.deepEqual(await ids(c.store), ["a", "b"]);
});
test('resolve "folder": deleted-here comes back, missing-from-folder is deleted here, new snippets still sync', async () => {
  const c = await trippedSetup();
  const r = await run(c, { resolve: "folder" });
  assert.equal(r.status, "ok");
  assert.deepEqual(await ids(c.store), [...names(9), "f1", "n1"].sort());
  assert.deepEqual([...c.folder.files.keys()].sort(), [...names(9), "f1", "n1"].sort());
  const st = await c.state.get();
  assert.equal(st.status, "ok");
  assert.equal(st.decision, null);
});
test('resolve "local": deleted-here stays deleted, missing-from-folder is re-pushed, new snippets still sync', async () => {
  const c = await trippedSetup();
  const r = await run(c, { resolve: "local" });
  assert.equal(r.status, "ok");
  const expected = [...names(4).map((_, i) => `s${i + 6}`), "f1", "n1"].sort();
  assert.deepEqual(await ids(c.store), expected);
  assert.deepEqual([...c.folder.files.keys()].sort(), expected);
  assert.equal((await c.state.get()).decision, null);
});
test('a Restore-sized deletion with resolve "local" mirrors the restore into the folder', async () => {
  const c = await linked(names(10).map((i) => sn(i)));
  await c.store.replaceAll([sn("s0"), sn("s1")]);
  assert.equal((await run(c)).status, "needs-decision");
  await run(c, { resolve: "local" });
  assert.deepEqual([...c.folder.files.keys()].sort(), ["s0", "s1"]);
  assert.deepEqual(await ids(c.store), ["s0", "s1"]);
});
test("a second run directly after a run writes nothing and reads no content", async () => {
  const c = await trippedSetup();
  await run(c, { resolve: "local" });
  c.folder.calls.read.length = c.folder.calls.write.length = c.folder.calls.remove.length = 0;
  c.area.gets.length = 0;
  const r = await run(c);
  assert.deepEqual(c.folder.calls, { read: [], write: [], remove: [] });
  assert.deepEqual(contentKeys(c.area), []);
  assert.deepEqual(r.counts, { pushed: 0, pulled: 0, deletedLocal: 0, deletedFiles: 0, renamed: 0, skipped: 0 });
});

// ---- review fixes ----
test("synced is saved periodically during a long run, not only at the end", async () => {
  const c = await setup({ local: names(60).map((i) => sn(i)) });
  let saves = 0;
  const orig = c.state.set;
  c.state.set = (patch) => { if (patch.synced) saves++; return orig(patch); };
  await run(c, { firstLink: true });
  assert.ok(saves >= 3, `expected at least 3 saves, got ${saves}`);
});
test("a file that cannot be written is skipped and counted; the run continues", async () => {
  const c = await setup({ local: [sn("a"), sn("b"), sn("c")] });
  c.folder.failWriteOn = "b";
  const r = await run(c, { firstLink: true });
  assert.equal(r.status, "ok");
  assert.equal(r.counts.skipped, 1);
  assert.equal(r.counts.pushed, 2);
  assert.deepEqual(Object.keys((await c.state.get()).synced).sort(), ["a", "c"]);
  assert.match((await c.state.get()).message, /1 files could not be synced/);
});

test("permission lost during the last write: the run pauses instead of reporting ok", async () => {
  const c = await setup({ local: [sn("a")] });
  c.folder.failWriteOn = "a";
  c.folder.permLostAfter = 2; // start check and pre-action check pass, the check after the failure does not
  const r = await run(c, { firstLink: true });
  assert.equal(r.status, "paused");
  assert.equal((await c.state.get()).status, "paused");
});

test("engine syncs against the Dropbox adapter", async () => {
  const u = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const c = await setup({ local: [sn(u(1)), sn(u(2))] });
  const dbx = fakeDropbox();
  const auth = { hasLink: async () => true, accessToken: async () => dbx.currentToken() };
  const dropbox = createDropbox({ fetch: dbx.fetch, auth, sleep: async () => {} });
  for (const n of [3, 4]) await dropbox.write(sn(u(n)));
  const r = await runSync({ store: c.store, folder: dropbox, state: c.state, now: c.now, firstLink: true });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.counts, { pushed: 2, pulled: 2, deletedLocal: 0, deletedFiles: 0, renamed: 0, skipped: 0 });
  assert.deepEqual(await ids(c.store), [u(1), u(2), u(3), u(4)]);
  assert.deepEqual([...dbx.files.keys()].sort(), [1, 2, 3, 4].map((n) => `/${u(n)}.json`));
  const r2 = await runSync({ store: c.store, folder: dropbox, state: c.state, now: c.now });
  assert.deepEqual(r2.counts, { pushed: 0, pulled: 0, deletedLocal: 0, deletedFiles: 0, renamed: 0, skipped: 0 });
});

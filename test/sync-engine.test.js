import { test } from "node:test";
import assert from "node:assert/strict";
import { runSync } from "../extension/lib/sync-engine.js";
import { setup, sn } from "./helpers/sync-fakes.js";

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
  assert.equal(r.status, "error");
  assert.deepEqual(Object.keys((await c.state.get()).synced).sort(), ["a", "b"]);
});

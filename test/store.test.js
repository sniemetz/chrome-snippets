import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, StoreError } from "../extension/lib/store.js";

function memArea() {
  const data = {};
  const gets = [];
  return {
    data, gets,
    async get(keys) {
      gets.push(keys);
      const ks = keys == null ? Object.keys(data) : [].concat(keys);
      const out = {};
      for (const k of ks) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}
function setup() {
  let t = 1000, n = 0;
  const area = memArea();
  const store = createStore(area, { now: () => t++, uuid: () => `id${++n}` });
  return { store, area };
}
const contentKeysRead = (area) => area.gets.flat().filter((k) => typeof k === "string" && k.startsWith("c:"));
const rejectsWith = (p, code) => assert.rejects(p, (e) => e instanceof StoreError && e.code === code);

test("list is empty when nothing stored", async () => {
  assert.deepEqual(await setup().store.list(), []);
});
test("add trims name, normalises tags, sets timestamps and id, returns full snippet", async () => {
  const { store } = setup();
  await store.add({ name: "A", content: "x", tags: ["Work"] });
  const b = await store.add({ name: "  B  ", content: "y", tags: ["work", " new "] });
  assert.equal(b.name, "B");
  assert.equal(b.content, "y");
  assert.deepEqual(b.tags, ["Work", "new"]);
  assert.equal(b.created, b.modified);
  assert.equal(b.id, "id2");
  assert.equal((await store.list()).length, 2);
});
test("add rejects whitespace-only name", async () => {
  await rejectsWith(setup().store.add({ name: "   ", content: "x", tags: [] }), "NAME_REQUIRED");
});
test("add rejects empty content", async () => {
  await rejectsWith(setup().store.add({ name: "a", content: "", tags: [] }), "CONTENT_REQUIRED");
});
test("add rejects duplicate name case-insensitively", async () => {
  const { store } = setup();
  await store.add({ name: "foo", content: "x", tags: [] });
  await rejectsWith(store.add({ name: "Foo", content: "y", tags: [] }), "DUPLICATE_NAME");
});
test("update with unchanged name succeeds, keeps created, bumps modified, refreshes preview", async () => {
  const { store } = setup();
  const a = await store.add({ name: "a", content: "x", tags: [] });
  const u = await store.update(a.id, { name: "a", content: "z\nline2", tags: [] });
  assert.equal(u.created, a.created);
  assert.ok(u.modified > a.modified);
  assert.equal((await store.get(a.id)).content, "z\nline2");
  assert.equal((await store.listMeta())[0].preview, "z line2");
});
test("update to another snippet's name rejects DUPLICATE_NAME", async () => {
  const { store } = setup();
  await store.add({ name: "a", content: "x", tags: [] });
  const b = await store.add({ name: "b", content: "x", tags: [] });
  await rejectsWith(store.update(b.id, { name: "A", content: "x", tags: [] }), "DUPLICATE_NAME");
});
test("update unknown id rejects NOT_FOUND", async () => {
  await rejectsWith(setup().store.update("nope", { name: "a", content: "x", tags: [] }), "NOT_FOUND");
});
test("remove deletes meta and content key", async () => {
  const { store, area } = setup();
  const a = await store.add({ name: "a", content: "x", tags: [] });
  await store.remove(a.id);
  assert.deepEqual(await store.listMeta(), []);
  assert.equal(`c:${a.id}` in area.data, false);
});
test("replaceAll and addMany keep meta and content in step, replaceAll drops old content keys", async () => {
  const { store, area } = setup();
  const old = await store.add({ name: "old", content: "o", tags: [] });
  await store.replaceAll([{ id: "1", name: "a", content: "x", tags: [], created: 0, modified: 0 }]);
  await store.addMany([{ id: "2", name: "b", content: "y", tags: [], created: 0, modified: 0 }]);
  assert.deepEqual((await store.list()).map((x) => x.id), ["1", "2"]);
  assert.equal(`c:${old.id}` in area.data, false);
});

// ---- large-library behaviour: content is read only for edit, paste, search ----
test("listMeta returns metadata with preview and never reads content keys", async () => {
  const { store, area } = setup();
  await store.add({ name: "a", content: "x".repeat(500), tags: ["t"] });
  area.gets.length = 0;
  const metas = await store.listMeta();
  assert.equal(metas[0].preview.length, 60);
  assert.equal(metas[0].content, undefined);
  assert.deepEqual(contentKeysRead(area), []);
});
test("add and update read no content keys", async () => {
  const { store, area } = setup();
  const a = await store.add({ name: "a", content: "x", tags: [] });
  await store.update(a.id, { name: "a", content: "y", tags: [] });
  assert.deepEqual(contentKeysRead(area), []);
});
test("get reads exactly one content key", async () => {
  const { store, area } = setup();
  const a = await store.add({ name: "a", content: "x", tags: [] });
  await store.add({ name: "b", content: "y", tags: [] });
  area.gets.length = 0;
  assert.equal((await store.get(a.id)).content, "x");
  assert.deepEqual(contentKeysRead(area), [`c:${a.id}`]);
});
test("search with empty query reads no content keys; tag filter case-insensitive", async () => {
  const { store, area } = setup();
  await store.add({ name: "b", content: "x", tags: ["Work"] });
  await store.add({ name: "a", content: "y", tags: ["home"] });
  area.gets.length = 0;
  assert.deepEqual((await store.search({ tag: "work" })).map((m) => m.name), ["b"]);
  assert.deepEqual((await store.search({})).map((m) => m.name), ["a", "b"]);
  assert.deepEqual(contentKeysRead(area), []);
});
test("search finds by name, tag and content, sorted, AND with tag", async () => {
  const { store } = setup();
  await store.add({ name: "Zed", content: "nothing", tags: [] });
  await store.add({ name: "alpha", content: "has NEEDLE inside", tags: ["x"] });
  await store.add({ name: "needle-name", content: "q", tags: [] });
  await store.add({ name: "c", content: "q", tags: ["needle-tag"] });
  const names = (r) => r.map((m) => m.name);
  assert.deepEqual(names(await store.search({ query: "needle" })), ["alpha", "c", "needle-name"]);
  assert.deepEqual(names(await store.search({ query: "needle", tag: "x" })), ["alpha"]);
});
test("search treats regex characters literally", async () => {
  const { store } = setup();
  await store.add({ name: "a", content: "call(x.*(", tags: [] });
  await store.add({ name: "b", content: "plain", tags: [] });
  assert.deepEqual((await store.search({ query: ".*(" })).map((m) => m.name), ["a"]);
});
test("search reads content in bounded chunks (max 25 keys per read), only for non-meta matches", async () => {
  const { store, area } = setup();
  for (let i = 0; i < 60; i++) await store.add({ name: `s${i}`, content: i === 59 ? "target" : "no", tags: [] });
  area.gets.length = 0;
  const r = await store.search({ query: "target" });
  assert.deepEqual(r.map((m) => m.name), ["s59"]);
  const contentReads = area.gets.filter((k) => Array.isArray(k) && k.some((x) => x.startsWith("c:")));
  assert.ok(contentReads.length >= 3);
  assert.ok(contentReads.every((k) => k.length <= 25));
  // a query that matches by name needs no content read for those snippets
  area.gets.length = 0;
  await store.search({ query: "s1" });
  const read = contentKeysRead(area).length;
  assert.ok(read < 60, `read ${read} content keys`);
});

test("listMeta is sorted by name case-insensitively (palette opens in manager order)", async () => {
  const { store } = setup();
  for (const n of ["b", "C", "a"]) await store.add({ name: n, content: "x", tags: [] });
  assert.deepEqual((await store.listMeta()).map((m) => m.name), ["a", "b", "C"]);
});

// ---- tag operations (meta only) ----
const addTagged = async (store, name, tags) => store.add({ name, content: "x", tags });
const tagsOf = async (store) => Object.fromEntries((await store.listMeta()).map((m) => [m.name, m.tags]));

test("renameTag changes the tag on all snippets and returns the count", async () => {
  const { store } = setup();
  await addTagged(store, "s1", ["a"]);
  await addTagged(store, "s2", ["a", "b"]);
  await addTagged(store, "s3", ["c"]);
  assert.equal(await store.renameTag("a", "z"), 2);
  assert.deepEqual(await tagsOf(store), { s1: ["z"], s2: ["z", "b"], s3: ["c"] });
});
test("renameTag merges into an existing tag, existing spelling wins, no duplicates", async () => {
  const { store } = setup();
  await addTagged(store, "s1", ["Foo", "Bar"]);
  await addTagged(store, "s2", ["foo"]);
  await store.renameTag("Foo", "bar");
  assert.deepEqual(await tagsOf(store), { s1: ["Bar"], s2: ["Bar"] });
});
test("renameTag allows a case-only change", async () => {
  const { store } = setup();
  await addTagged(store, "s1", ["foo"]);
  assert.equal(await store.renameTag("foo", "Foo"), 1);
  assert.deepEqual(await tagsOf(store), { s1: ["Foo"] });
});
test("renameTag rejects an empty or whitespace target and writes nothing", async () => {
  const { store, area } = setup();
  await addTagged(store, "s1", ["a"]);
  let sets = 0;
  const orig = area.set;
  area.set = async (o) => { sets++; return orig(o); };
  await rejectsWith(store.renameTag("a", "   "), "TAG_REQUIRED");
  assert.equal(sets, 0);
});
test("renameTag of an unknown tag returns 0 and does not write", async () => {
  const { store, area } = setup();
  await addTagged(store, "s1", ["a"]);
  let sets = 0;
  const orig = area.set;
  area.set = async (o) => { sets++; return orig(o); };
  assert.equal(await store.renameTag("nope", "z"), 0);
  assert.equal(sets, 0);
});
test("deleteTag removes case-insensitively and returns the count", async () => {
  const { store } = setup();
  await addTagged(store, "s1", ["Work", "b"]);
  await addTagged(store, "s2", ["c"]);
  assert.equal(await store.deleteTag("work"), 1);
  assert.deepEqual(await tagsOf(store), { s1: ["b"], s2: ["c"] });
  assert.equal(await store.deleteTag("missing"), 0);
});
test("tag operations read no content keys", async () => {
  const { store, area } = setup();
  await addTagged(store, "s1", ["a"]);
  area.gets.length = 0;
  await store.renameTag("a", "b");
  await store.deleteTag("b");
  assert.deepEqual(contentKeysRead(area), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, StoreError } from "../extension/lib/store.js";

function memArea() {
  const data = {};
  return {
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
  };
}
function setup() {
  let t = 1000, n = 0;
  const store = createStore(memArea(), { now: () => t++, uuid: () => `id${++n}` });
  return store;
}
const rejectsWith = (p, code) => assert.rejects(p, (e) => e instanceof StoreError && e.code === code);

test("list is empty when key absent", async () => {
  assert.deepEqual(await setup().list(), []);
});
test("add trims name, normalises tags, sets timestamps and id", async () => {
  const s = setup();
  await s.add({ name: "A", content: "x", tags: ["Work"] });
  const b = await s.add({ name: "  B  ", content: "y", tags: ["work", " new "] });
  assert.equal(b.name, "B");
  assert.deepEqual(b.tags, ["Work", "new"]);
  assert.equal(b.created, b.modified);
  assert.equal(b.id, "id2");
  assert.equal((await s.list()).length, 2);
});
test("add rejects whitespace-only name", async () => {
  await rejectsWith(setup().add({ name: "   ", content: "x", tags: [] }), "NAME_REQUIRED");
});
test("add rejects empty content", async () => {
  await rejectsWith(setup().add({ name: "a", content: "", tags: [] }), "CONTENT_REQUIRED");
});
test("add rejects duplicate name case-insensitively", async () => {
  const s = setup();
  await s.add({ name: "foo", content: "x", tags: [] });
  await rejectsWith(s.add({ name: "Foo", content: "y", tags: [] }), "DUPLICATE_NAME");
});
test("update with unchanged name succeeds, keeps created, bumps modified", async () => {
  const s = setup();
  const a = await s.add({ name: "a", content: "x", tags: [] });
  const u = await s.update(a.id, { name: "a", content: "z", tags: [] });
  assert.equal(u.created, a.created);
  assert.ok(u.modified > a.modified);
  assert.equal(u.content, "z");
  assert.equal((await s.get(a.id)).content, "z");
});
test("update to another snippet's name rejects DUPLICATE_NAME", async () => {
  const s = setup();
  await s.add({ name: "a", content: "x", tags: [] });
  const b = await s.add({ name: "b", content: "x", tags: [] });
  await rejectsWith(s.update(b.id, { name: "A", content: "x", tags: [] }), "DUPLICATE_NAME");
});
test("update unknown id rejects NOT_FOUND", async () => {
  await rejectsWith(setup().update("nope", { name: "a", content: "x", tags: [] }), "NOT_FOUND");
});
test("remove deletes", async () => {
  const s = setup();
  const a = await s.add({ name: "a", content: "x", tags: [] });
  await s.remove(a.id);
  assert.deepEqual(await s.list(), []);
});
test("replaceAll and addMany", async () => {
  const s = setup();
  await s.replaceAll([{ id: "1", name: "a", content: "x", tags: [], created: 0, modified: 0 }]);
  await s.addMany([{ id: "2", name: "b", content: "y", tags: [], created: 0, modified: 0 }]);
  assert.deepEqual((await s.list()).map((x) => x.id), ["1", "2"]);
});

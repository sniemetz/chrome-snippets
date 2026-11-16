import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage } from "../extension/lib/messages.js";

const fakeStore = () => {
  const calls = [];
  return {
    calls,
    search: async (q) => { calls.push(["search", q]); return [{ id: "1", name: "a", tags: [], preview: "p", created: 1, modified: 2 }]; },
    get: async (id) => { calls.push(["get", id]); return id === "1" ? { id, content: "BODY" } : undefined; },
  };
};

test("snippet-search returns metas only", async () => {
  const s = fakeStore();
  const r = await handleMessage(s, { type: "snippet-search", query: "q" });
  assert.deepEqual(s.calls, [["search", { query: "q" }]]);
  assert.deepEqual(Object.keys(r), ["metas"]);
  assert.equal(r.metas[0].content, undefined);
});
test("snippet-search coerces a non-string query to empty", async () => {
  const s = fakeStore();
  await handleMessage(s, { type: "snippet-search", query: { evil: 1 } });
  assert.deepEqual(s.calls, [["search", { query: "" }]]);
});
test("snippet-content returns the content of one id", async () => {
  const s = fakeStore();
  assert.deepEqual(await handleMessage(s, { type: "snippet-content", id: "1" }), { content: "BODY" });
  assert.deepEqual(s.calls, [["get", "1"]]);
});
test("snippet-content for an unknown id returns no content", async () => {
  assert.deepEqual(await handleMessage(fakeStore(), { type: "snippet-content", id: "x" }), { content: null });
});
test("unknown or malformed messages return undefined", async () => {
  assert.equal(await handleMessage(fakeStore(), { type: "nope" }), undefined);
  assert.equal(await handleMessage(fakeStore(), null), undefined);
  assert.equal(await handleMessage(fakeStore(), { type: "snippet-content", id: 5 }), undefined);
});

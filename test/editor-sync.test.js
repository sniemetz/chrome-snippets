import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExternalChange } from "../extension/lib/editor-sync.js";

const meta = (modified) => ({ id: "a", name: "a", tags: [], preview: "", created: 1, modified });

test("snippet gone: notice-deleted, dirty or not", () => {
  assert.equal(classifyExternalChange(meta(1), undefined, false), "notice-deleted");
  assert.equal(classifyExternalChange(meta(1), undefined, true), "notice-deleted");
});
test("unchanged modified: none", () => {
  assert.equal(classifyExternalChange(meta(1), meta(1), false), "none");
  assert.equal(classifyExternalChange(meta(1), meta(1), true), "none");
});
test("changed and not dirty: refresh", () => assert.equal(classifyExternalChange(meta(1), meta(2), false), "refresh"));
test("changed and dirty: notice-changed", () => assert.equal(classifyExternalChange(meta(1), meta(2), true), "notice-changed"));

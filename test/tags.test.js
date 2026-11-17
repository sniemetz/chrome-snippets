import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTags, allTags } from "../extension/lib/tags.js";

test("normalizeTags trims and drops empty", () => {
  assert.deepEqual(normalizeTags([" Work ", "", "  "], []), ["Work"]);
});
test("normalizeTags reuses known spelling", () => {
  assert.deepEqual(normalizeTags(["work"], ["Work"]), ["Work"]);
});
test("normalizeTags dedupes case-insensitively, first wins", () => {
  assert.deepEqual(normalizeTags(["a", "A"], []), ["a"]);
});
test("allTags is unique, sorted case-insensitively, first-seen spelling", () => {
  assert.deepEqual(allTags([{ tags: ["b", "A"] }, { tags: ["a"] }]), ["A", "b"]);
});

import { tagCounts } from "../extension/lib/tags.js";

test("tagCounts counts snippets per tag case-insensitively, sorted, first-seen spelling", () => {
  const metas = [{ tags: ["b", "A"] }, { tags: ["a"] }, { tags: [] }];
  assert.deepEqual(tagCounts(metas), [{ tag: "A", count: 2 }, { tag: "b", count: 1 }]);
});
test("tagCounts of no snippets is empty", () => assert.deepEqual(tagCounts([]), []));

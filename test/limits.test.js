import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGE_SNIPPET_BYTES, contentBytes, largeWarning } from "../extension/lib/limits.js";

const msg = (n) => `This snippet is large (${n} kB). Large snippets slow search, sync and pasting.`;

test("threshold is 20000", () => assert.equal(LARGE_SNIPPET_BYTES, 20000));
test("contentBytes counts UTF-8 bytes", () => assert.equal(contentBytes("aé"), 3));
test("exactly 20000 bytes gives no warning", () => assert.equal(largeWarning("a".repeat(20000)), null));
test("20001 bytes warns with 20 kB", () => assert.equal(largeWarning("a".repeat(20001)), msg(20)));
test("120000 bytes warns with 120 kB", () => assert.equal(largeWarning("a".repeat(120000)), msg(120)));
test("multi-byte text counts bytes, not characters", () => {
  assert.equal(largeWarning("é".repeat(10000)), null);
  assert.equal(largeWarning("é".repeat(10001)), msg(20));
});

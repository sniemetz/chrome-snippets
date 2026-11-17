import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern, isPermissionError } from "../extension/lib/paste-target.js";

test("originPattern builds an origin match pattern from an https URL", () =>
  assert.equal(originPattern("https://a.example.com/x?y=1"), "https://a.example.com/*"));
test("originPattern ignores the port (Chrome host patterns have none)", () =>
  assert.equal(originPattern("http://localhost:3000/p"), "http://localhost/*"));
test("originPattern returns null for non-http(s) URLs", () => {
  assert.equal(originPattern("chrome://extensions"), null);
  assert.equal(originPattern("about:blank"), null);
  assert.equal(originPattern("file:///tmp/a.html"), null);
});
test("originPattern returns null for malformed or missing input", () => {
  assert.equal(originPattern("not a url"), null);
  assert.equal(originPattern(""), null);
  assert.equal(originPattern(undefined), null);
});
test("isPermissionError recognises Chrome's host-permission refusals", () => {
  assert.equal(isPermissionError(new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host.")), true);
  assert.equal(isPermissionError(new Error("Extension manifest must request permission to access this host.")), true);
});
test("isPermissionError is false for other errors", () => {
  assert.equal(isPermissionError(new Error("boom")), false);
  assert.equal(isPermissionError(undefined), false);
});

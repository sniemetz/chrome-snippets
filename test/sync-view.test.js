import { test } from "node:test";
import assert from "node:assert/strict";
import { pausedView, pausedStatusText, linkedView, unlinkText } from "../extension/lib/sync-view.js";

test("paused folder: re-allow action, old text fallback", () => {
  const v = pausedView({ backend: "folder", message: "" });
  assert.equal(v.action, "reallow");
  assert.equal(v.actionLabel, "Re-allow folder");
  assert.equal(v.text, "Folder access must be re-allowed");
  assert.equal(pausedStatusText({ backend: "folder", message: "" }), "Sync paused: folder access must be re-allowed");
});
test("paused dropbox: sign-in action, text from state", () => {
  const v = pausedView({ backend: "dropbox", message: "Sign in to Dropbox again" });
  assert.deepEqual(v, { text: "Sign in to Dropbox again", actionLabel: "Sign in", action: "signin" });
  assert.equal(pausedView({ backend: "dropbox", message: "" }).text, "Sign in to Dropbox again");
  assert.equal(pausedStatusText({ backend: "dropbox", message: "x" }), "x");
});
test("linked view per backend", () => {
  assert.deepEqual(linkedView({ backend: "dropbox", account: "a@b.c" }), { label: "Dropbox: a@b.c", showChangeFolder: false });
  assert.deepEqual(linkedView({ backend: "folder", folderName: "Sync" }), { label: "Folder: Sync", showChangeFolder: true });
});
test("unlink wording per backend", () => {
  assert.match(unlinkText({ backend: "dropbox" }), /^Unlink Dropbox\?/);
  assert.match(unlinkText({ backend: "folder" }), /^Unlink this folder\?/);
});
test("paused folder ignores st.message (engine always sets it)", () => {
  const st = { backend: "folder", message: "Folder access must be re-allowed" };
  assert.equal(pausedStatusText(st), "Sync paused: folder access must be re-allowed");
  assert.equal(pausedView(st).text, "Folder access must be re-allowed");
});

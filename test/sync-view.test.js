import { test } from "node:test";
import assert from "node:assert/strict";
import { pausedView, pausedStatusText, linkedView, unlinkText } from "../extension/lib/sync-view.js";

test("paused: sign-in action, text from state with fallback", () => {
  const v = pausedView({ message: "Sign in to Dropbox again" });
  assert.deepEqual(v, { text: "Sign in to Dropbox again", actionLabel: "Sign in", action: "signin" });
  assert.equal(pausedView({ message: "" }).text, "Sign in to Dropbox again");
  assert.equal(pausedStatusText({ message: "x" }), "x");
  assert.equal(pausedStatusText({ message: "" }), "Sign in to Dropbox again");
});
test("unlink wording", () => {
  assert.match(unlinkText({}), /^Unlink Dropbox\?/);
});
test("label falls back when account missing or empty", () => {
  assert.equal(linkedView({}).label, "Dropbox: connected");
  assert.equal(linkedView({ account: "" }).label, "Dropbox: connected");
  assert.equal(linkedView({ account: "a@b.c" }).label, "Dropbox: a@b.c");
});

import { signinInGate, codeCheck } from "../extension/lib/sync-view.js";
test("compact gate delegates Dropbox sign-in to the manager window", () => {
  assert.equal(signinInGate(true), "open-manager");
  assert.equal(signinInGate(false), "inline");
});
test("codeCheck trims and rejects empty", () => {
  assert.deepEqual(codeCheck("  abc \n"), { code: "abc" });
  assert.match(codeCheck("   ").error, /Paste the code/);
  assert.match(codeCheck(undefined).error, /Paste the code/);
});

import { codeApplies } from "../extension/lib/sync-view.js";
test("codeApplies: link only when unlinked, signin only when Dropbox is paused", () => {
  assert.equal(codeApplies({ linked: false }, "link"), true);
  assert.equal(codeApplies({ linked: true, backend: "dropbox", status: "ok" }, "link"), false);
  assert.equal(codeApplies({ linked: true, backend: "dropbox", status: "paused" }, "signin"), true);
  assert.equal(codeApplies({ linked: true, backend: "dropbox", status: "ok" }, "signin"), false);
  assert.equal(codeApplies({ linked: false }, "signin"), false);
  assert.equal(codeApplies({ linked: false }, null), false);
});

import { syncBusy, syncButtonView, unlinkDisabled } from "../extension/lib/sync-view.js";
test("syncBusy: persisted flag or pending click", () => {
  assert.equal(syncBusy({ syncing: false }), false);
  assert.equal(syncBusy({ syncing: true }), true);
  assert.equal(syncBusy({}, true), true);
});
test("button and unlink states follow busy", () => {
  assert.deepEqual(syncButtonView(false), { label: "Sync now", disabled: false, spinner: false });
  assert.deepEqual(syncButtonView(true), { label: "Syncing...", disabled: true, spinner: true });
  assert.equal(unlinkDisabled(true), true);
  assert.equal(unlinkDisabled(false), false);
});

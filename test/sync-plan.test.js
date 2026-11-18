import { test } from "node:test";
import assert from "node:assert/strict";
import { planSync } from "../extension/lib/sync-plan.js";

const L = (id, modified = 1) => ({ id, modified });
const F = (id, fileModified = 10) => ({ id, fileModified });
const S = (modified = 1, fileModified = 10) => ({ modified, fileModified });
const act = (r) => r.actions.map((a) => `${a.type}:${a.id}`).sort();
const run = (local, folder, synced, firstLink = false) => planSync({ local, folder, synced, firstLink });

test("local only, not synced: push", () => assert.deepEqual(act(run([L("a")], [], {})), ["push:a"]));
test("folder only, not synced: pull", () => assert.deepEqual(act(run([], [F("a")], {})), ["pull:a"]));
test("both, synced, neither changed: no action", () =>
  assert.deepEqual(act(run([L("a")], [F("a")], { a: S() })), []));
test("local changed only: push", () =>
  assert.deepEqual(act(run([L("a", 2)], [F("a")], { a: S() })), ["push:a"]));
test("folder changed only: pull", () =>
  assert.deepEqual(act(run([L("a")], [F("a", 11)], { a: S() })), ["pull:a"]));
test("both changed: conflict", () =>
  assert.deepEqual(act(run([L("a", 2)], [F("a", 11)], { a: S() })), ["conflict:a"]));
test("deleted locally, file unchanged: deleteFile", () =>
  assert.deepEqual(act(run([], [F("a")], { a: S() })), ["deleteFile:a"]));
test("deleted in folder, local unchanged: deleteLocal", () =>
  assert.deepEqual(act(run([L("a")], [], { a: S() })), ["deleteLocal:a"]));
test("neither side, synced: forget", () => assert.deepEqual(act(run([], [], { a: S() })), ["forget:a"]));
test("edit beats delete (folder side): local missing, file changed -> pull", () =>
  assert.deepEqual(act(run([], [F("a", 11)], { a: S() })), ["pull:a"]));
test("edit beats delete (local side): folder missing, local changed -> push", () =>
  assert.deepEqual(act(run([L("a", 2)], [], { a: S() })), ["push:a"]));
test("first link: same id on both sides is a conflict, others push/pull", () =>
  assert.deepEqual(act(run([L("a"), L("b")], [F("a"), F("c")], {}, true)), ["conflict:a", "pull:c", "push:b"]));

const many = (n, p = "x") => Array.from({ length: n }, (_, i) => `${p}${i}`);
const synced = (ids) => Object.fromEntries(ids.map((i) => [i, S()]));

test("guard trips above threshold: 6 deleteLocal of 20", () => {
  const ids = many(20);
  const folder = ids.slice(6).map((i) => F(i));
  const r = run(ids.map((i) => L(i)), folder, synced(ids));
  assert.equal(r.guard.tripped, true);
  assert.equal(r.guard.conflicts, 6);
  assert.equal(r.guard.threshold, 5);
  assert.equal(r.guard.reason, "count");
});
test("guard does not trip at 5 deleteLocal of 20", () => {
  const ids = many(20);
  const r = run(ids.map((i) => L(i)), ids.slice(5).map((i) => F(i)), synced(ids));
  assert.equal(r.guard.tripped, false);
  assert.equal(r.guard.conflicts, 5);
});
test("threshold scales: 20% of 100 is 20", () => {
  const ids = many(100);
  const r = run(ids.map((i) => L(i)), ids.slice(20).map((i) => F(i)), synced(ids));
  assert.equal(r.guard.threshold, 20);
  assert.equal(r.guard.tripped, false);
});
test("guard trips on empty folder with synced history, local non-empty", () => {
  const r = run([L("a")], [], { a: S() });
  assert.equal(r.guard.tripped, true);
  assert.equal(r.guard.reason, "folder-empty");
});
test("guard trips on empty local with synced history, folder non-empty", () => {
  const r = run([], [F("a")], { a: S() });
  assert.equal(r.guard.tripped, true);
  assert.equal(r.guard.reason, "local-empty");
});
test("guard never trips on first link", () => {
  const r = run(many(30).map((i) => L(i)), [], {}, true);
  assert.equal(r.guard.tripped, false);
  assert.equal(r.guard.reason, null);
});
test("plain pushes never count", () => {
  const ids = many(50);
  const r = run(ids.map((i) => L(i, 2)), ids.map((i) => F(i)), synced(ids));
  assert.equal(r.actions.filter((a) => a.type === "push").length, 50);
  assert.equal(r.guard.tripped, false);
  assert.equal(r.guard.conflicts, 0);
});

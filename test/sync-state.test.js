import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncState, defaultState, INTERVALS } from "../extension/lib/sync-state.js";
import { memArea } from "./helpers/mem-area.js";

test("defaults when empty", async () => {
  assert.deepEqual(await createSyncState(memArea()).get(), defaultState());
  assert.deepEqual(defaultState(), { linked: false, folderName: "", intervalMin: 15, status: "ok", lastSync: null,
    message: "", summary: null, decision: null, synced: {}, backend: "folder", account: "", syncing: false });
});
test("defaultState has backend folder and empty account", () => {
  assert.equal(defaultState().backend, "folder");
  assert.equal(defaultState().account, "");
});
test("state saved without backend reads back as folder", async () => {
  const area = memArea();
  await area.set({ sync: { linked: true, folderName: "f", intervalMin: 30 } });
  const s = await createSyncState(area).get();
  assert.equal(s.backend, "folder");
  assert.equal(s.account, "");
});
test("set merges; get returns defaults plus patch", async () => {
  const st = createSyncState(memArea());
  await st.set({ linked: true, folderName: "f" });
  const r = await st.set({ status: "paused" });
  assert.equal(r.status, "paused");
  assert.deepEqual(await st.get(), { ...defaultState(), linked: true, folderName: "f", status: "paused" });
});
test("clear resets to defaults", async () => {
  const st = createSyncState(memArea());
  await st.set({ linked: true, synced: { a: { modified: 1, fileModified: 2 } } });
  await st.clear();
  assert.deepEqual(await st.get(), defaultState());
});
test("INTERVALS exact", () => {
  assert.deepEqual(INTERVALS.map((i) => [i.min, i.label]), [[15, "15 min"], [30, "30 min"], [60, "1 h"], [120, "2 h"], [360, "6 h"], [720, "12 h"]]);
});
test("unknown stored intervalMin falls back to 15", async () => {
  const area = memArea();
  await area.set({ sync: { linked: true, intervalMin: 7 } });
  assert.equal((await createSyncState(area).get()).intervalMin, 15);
});

import { needsAttention } from "../extension/lib/sync-state.js";
test("needsAttention: only a linked folder that is paused or needs a decision", () => {
  const st = (o) => ({ ...defaultState(), ...o });
  assert.equal(needsAttention(st({ linked: true, status: "paused" })), true);
  assert.equal(needsAttention(st({ linked: true, status: "needs-decision" })), true);
  assert.equal(needsAttention(st({ linked: true, status: "ok" })), false);
  assert.equal(needsAttention(st({ linked: true, status: "error" })), false);
  assert.equal(needsAttention(st({ linked: false, status: "paused" })), false);
});

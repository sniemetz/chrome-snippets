import { test } from "node:test";
import assert from "node:assert/strict";
import { createPending, PENDING_TTL_MS } from "../extension/lib/dropbox-pending.js";
import { memArea } from "./helpers/mem-area.js";

function setup() {
  const area = memArea();
  const clock = { t: 1000 };
  return { area, clock, p: createPending({ area, now: () => clock.t }) };
}

test("begin stores verifier, mode and createdAt under dropboxPending", async () => {
  const { area, p } = setup();
  await p.begin("V", "link");
  assert.deepEqual(area.data.dropboxPending, { verifier: "V", mode: "link", createdAt: 1000 });
});
test("mode round-trips and get does not delete", async () => {
  const { area, p } = setup();
  await p.begin("V", "signin");
  assert.deepEqual(await p.get(), { verifier: "V", mode: "signin" });
  assert.deepEqual(await p.get(), { verifier: "V", mode: "signin" });
  assert.ok(area.data.dropboxPending);
});
test("bad mode is rejected and stores nothing", async () => {
  const { area, p } = setup();
  await assert.rejects(p.begin("V", "x"), /mode/);
  assert.equal(area.data.dropboxPending, undefined);
});
test("clear deletes; get is then null", async () => {
  const { p } = setup();
  await p.begin("V", "link");
  await p.clear();
  assert.equal(await p.get(), null);
});
test("a newer begin overwrites the older one", async () => {
  const { p } = setup();
  await p.begin("OLD", "link"); await p.begin("NEW", "signin");
  assert.deepEqual(await p.get(), { verifier: "NEW", mode: "signin" });
});
test("valid at exactly 15 min, expired after; expired entry is deleted", async () => {
  const a = setup();
  await a.p.begin("V", "link"); a.clock.t += PENDING_TTL_MS;
  assert.deepEqual(await a.p.get(), { verifier: "V", mode: "link" });
  const b = setup();
  await b.p.begin("V", "link"); b.clock.t += PENDING_TTL_MS + 1;
  assert.equal(await b.p.get(), null);
  assert.equal(b.area.data.dropboxPending, undefined);
});
test("malformed or mode-less entry yields null and is deleted", async () => {
  for (const bad of [{ verifier: 5 }, { verifier: "V", createdAt: 1000 }]) {
    const { area, p } = setup();
    await area.set({ dropboxPending: bad });
    assert.equal(await p.get(), null);
    assert.equal(area.data.dropboxPending, undefined);
  }
});

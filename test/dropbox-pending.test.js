import { test } from "node:test";
import assert from "node:assert/strict";
import { createPending, PENDING_TTL_MS } from "../extension/lib/dropbox-pending.js";
import { memArea } from "./helpers/mem-area.js";

function setup() {
  const area = memArea();
  const clock = { t: 1000 };
  return { area, clock, p: createPending({ area, now: () => clock.t }) };
}

test("begin stores verifier and createdAt under dropboxPending", async () => {
  const { area, p } = setup();
  await p.begin("V");
  assert.deepEqual(area.data.dropboxPending, { verifier: "V", createdAt: 1000 });
});
test("consume returns the verifier once and deletes it", async () => {
  const { area, p } = setup();
  await p.begin("V");
  assert.equal(await p.consume(), "V");
  assert.equal(area.data.dropboxPending, undefined);
  assert.equal(await p.consume(), null);
});
test("a newer begin overwrites the older one", async () => {
  const { p } = setup();
  await p.begin("OLD"); await p.begin("NEW");
  assert.equal(await p.consume(), "NEW");
});
test("valid at exactly 15 min, expired after; expired entry is deleted", async () => {
  const a = setup();
  await a.p.begin("V"); a.clock.t += PENDING_TTL_MS;
  assert.equal(await a.p.consume(), "V");
  const b = setup();
  await b.p.begin("V"); b.clock.t += PENDING_TTL_MS + 1;
  assert.equal(await b.p.consume(), null);
  assert.equal(b.area.data.dropboxPending, undefined);
});
test("malformed entry yields null and is deleted", async () => {
  const { area, p } = setup();
  await area.set({ dropboxPending: { verifier: 5 } });
  assert.equal(await p.consume(), null);
  assert.equal(area.data.dropboxPending, undefined);
});

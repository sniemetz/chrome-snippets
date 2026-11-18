import { test } from "node:test";
import assert from "node:assert/strict";
import { decideClash } from "../extension/lib/name-clash.js";

const sn = (id, content, name = "Email signature") => ({ id, name, content, tags: [], created: 1, modified: 1 });

test("identical content: same snippet, smaller id kept, independent of argument order", () => {
  const x = sn("a1", "hi"), y = sn("b2", "hi");
  const expected = { kind: "same", keep: "a1", drop: "b2" };
  assert.deepEqual(decideClash(x, y, new Set()), expected);
  assert.deepEqual(decideClash(y, x, new Set()), expected);
});
test("different content: larger id renamed to (2), independent of argument order", () => {
  const x = sn("a1", "hi"), y = sn("b2", "ho");
  const expected = { kind: "rename", id: "b2", newName: "Email signature (2)" };
  assert.deepEqual(decideClash(x, y, new Set(["email signature"])), expected);
  assert.deepEqual(decideClash(y, x, new Set(["email signature"])), expected);
});
test("(2) taken: next free number, case-insensitive", () => {
  const x = sn("a1", "hi"), y = sn("b2", "ho");
  const r = decideClash(x, y, new Set(["email signature", "email signature (2)"]));
  assert.deepEqual(r, { kind: "rename", id: "b2", newName: "Email signature (3)" });
  const r2 = decideClash(x, y, new Set(["email signature (2)"].map((s) => s.toLowerCase())));
  assert.equal(r2.newName, "Email signature (3)");
});

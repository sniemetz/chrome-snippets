import { test } from "node:test";
import assert from "node:assert/strict";
import { centeredPosition } from "../extension/lib/position.js";

const size = { width: 616, height: 490 };

test("centers the window in the parent", () =>
  assert.deepEqual(centeredPosition({ left: 0, top: 0, width: 1616, height: 1090 }, size), { left: 500, top: 300 }));
test("respects the parent's offset (second monitor)", () =>
  assert.deepEqual(centeredPosition({ left: 1920, top: 100, width: 1000, height: 800 }, size), { left: 1920 + 192, top: 100 + 155 }));
test("a parent smaller than the window aligns to the parent's top-left", () =>
  assert.deepEqual(centeredPosition({ left: 50, top: 60, width: 300, height: 200 }, size), { left: 50, top: 60 }));
test("missing or non-numeric fields leave placement to Chrome", () => {
  assert.deepEqual(centeredPosition(undefined, size), {});
  assert.deepEqual(centeredPosition({ left: 0, top: 0 }, size), {});
  assert.deepEqual(centeredPosition({ left: NaN, top: 0, width: 1000, height: 800 }, size), {});
});

import { besidePosition } from "../extension/lib/position.js";
test("besidePosition: right of the manager when it fits", () => {
  assert.deepEqual(besidePosition({ left: 100, top: 50, width: 616 }, { width: 520 }, { left: 0, width: 1920 }), { left: 724, top: 50 });
});
test("besidePosition: left when right is off-screen, {} when neither fits or unknown", () => {
  assert.deepEqual(besidePosition({ left: 1000, top: 50, width: 616 }, { width: 520 }, { left: 0, width: 1920 }), { left: 472, top: 50 });
  assert.deepEqual(besidePosition({ left: 100, top: 50, width: 616 }, { width: 520 }, { left: 0, width: 1000 }), {});
  assert.deepEqual(besidePosition({ left: 100, top: 50, width: 616 }, { width: 520 }, undefined), {});
  assert.deepEqual(besidePosition(undefined, { width: 520 }, { left: 0, width: 1920 }), {});
});

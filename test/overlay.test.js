import { test } from "node:test";
import assert from "node:assert/strict";
import { openPalette } from "../extension/lib/overlay.js";

// A permissive fake: any property access, call or construction yields the same inert object.
const inert = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : p === "length" ? 0 : inert),
  set: () => true,
  apply: () => inert,
  construct: () => inert,
  has: () => true,
});

test("openPalette is self-contained: runs with no module scope and no ReferenceError", () => {
  const detached = new Function("return " + openPalette.toString())();
  const fakes = { document: inert, window: inert, navigator: inert, getSelection: () => inert };
  const saved = {};
  for (const [k, v] of Object.entries(fakes)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try {
    detached([{ id: "1", name: "a", content: "x", tags: ["t"] }]);
  } finally {
    for (const k of Object.keys(fakes)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k];
    }
  }
});

test("openPalette source has no import/export references inside the function body", () => {
  assert.doesNotMatch(openPalette.toString(), /\bimport\s*\(|\brequire\s*\(/);
});

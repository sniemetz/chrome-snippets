import { test } from "node:test";
import assert from "node:assert/strict";
import { copyWithFeedback, copyTextWithFeedback } from "../extension/popup/copy.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const label = (text) => ({ textContent: text, dataset: {} });
const T = { flashMs: 30, closeDelayMs: 10 };

function env({ writeFails = false } = {}) {
  const log = [];
  const saved = {};
  const fakes = {
    navigator: { clipboard: { writeText: async (t) => { log.push(["write", t]); if (writeFails) throw new Error("denied"); } } },
    window: { close: () => log.push(["close"]) },
  };
  for (const [k, v] of Object.entries(fakes)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  const restore = () => { for (const k of Object.keys(fakes)) if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; };
  return { log, restore };
}

test("copies the snippet content, shows Copied! then restores the name", async () => {
  const e = env();
  try {
    const el = label("My name");
    await copyWithFeedback({ get: async () => ({ content: "BODY" }) }, "1", el, T);
    assert.deepEqual(e.log, [["write", "BODY"]]);
    assert.equal(el.textContent, "Copied!");
    await wait(60);
    assert.equal(el.textContent, "My name");
  } finally { e.restore(); }
});
test("a snippet that no longer exists: no write, Copy failed, no Copied!", async () => {
  const e = env();
  try {
    const el = label("Gone");
    await copyWithFeedback({ get: async () => undefined }, "1", el, T);
    assert.deepEqual(e.log, []);
    assert.equal(el.textContent, "Copy failed");
    await wait(60);
    assert.equal(el.textContent, "Gone");
  } finally { e.restore(); }
});
test("a store error shows Copy failed and does not throw", async () => {
  const e = env();
  try {
    const el = label("X");
    await copyWithFeedback({ get: async () => { throw new Error("boom"); } }, "1", el, T);
    assert.equal(el.textContent, "Copy failed");
  } finally { e.restore(); }
});
test("a clipboard failure shows Copy failed and never closes", async () => {
  const e = env({ writeFails: true });
  try {
    const el = label("X");
    await copyTextWithFeedback("t", el, { ...T, closeAfter: true });
    assert.equal(el.textContent, "Copy failed");
    await wait(40);
    assert.ok(!e.log.some((x) => x[0] === "close"));
  } finally { e.restore(); }
});
test("closeAfter closes only after the clipboard write finished", async () => {
  const e = env();
  try {
    await copyTextWithFeedback("t", label("X"), { ...T, closeAfter: true });
    await wait(40);
    assert.deepEqual(e.log.map((x) => x[0]), ["write", "close"]);
  } finally { e.restore(); }
});
test("a second click while Copied! is showing does not make it permanent", async () => {
  const e = env();
  try {
    const el = label("Name");
    await copyTextWithFeedback("t", el, T);
    await copyTextWithFeedback("t", el, T);
    await wait(70);
    assert.equal(el.textContent, "Name");
  } finally { e.restore(); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { openPalette } from "../extension/lib/overlay.js";

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.isConnected = true;
    this.value = "";
    this.className = "";
    this.textContent = "";
    this.dataset = {};
  }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = n; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  attachShadow() { this.shadow = new FakeEl("shadow"); return this.shadow; }
  querySelector() { return null; }
  focus() {}
  remove() { this.isConnected = false; }
  fire(t, ev = {}) { for (const f of this.listeners[t] ?? []) f({ preventDefault() {}, stopPropagation() {}, ...ev }); }
  findAll(pred, out = []) {
    for (const c of [...this.children, ...(this.shadow ? [this.shadow] : [])]) {
      if (pred(c)) out.push(c);
      if (c instanceof FakeEl) c.findAll(pred, out);
    }
    return out;
  }
}

function env({ search = () => ({ metas: [] }), content = () => ({ content: "BODY" }), focused = null } = {}) {
  const created = [];
  const messages = [];
  const copied = [];
  const execCalls = [];
  const doc = {
    activeElement: focused,
    createElement: (t) => { const e = new FakeEl(t); created.push(e); return e; },
    getElementById: () => null,
    documentElement: new FakeEl("html"),
    body: new FakeEl("body"),
    execCommand: (...a) => { execCalls.push(a); return false; },
  };
  const chromeFake = {
    runtime: {
      sendMessage: async (m) => { messages.push(m); return m.type === "snippet-search" ? search(m) : content(m); },
    },
  };
  const nav = { clipboard: { writeText: async (t) => { copied.push(t); } } };
  const win = { getSelection: () => null };
  const g = { document: doc, chrome: chromeFake, navigator: nav, window: win };
  const saved = {};
  for (const [k, v] of Object.entries(g)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  const restore = () => {
    for (const k of Object.keys(g)) if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k];
  };
  return { doc, created, messages, copied, execCalls, restore };
}
const run = (fn, ...a) => new Function("return " + fn.toString())()(...a); // detached: no module scope
const meta = (id, name) => ({ id, name, tags: [], preview: `${name} preview` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const inputEl = (e) => e.created.find((x) => x.tagName === "INPUT");
const rows = (e) => e.created.filter((x) => x.tagName === "LI" && x.className !== "e");

test("self-contained: the function body really runs detached from module scope", () => {
  const e = env();
  try {
    run(openPalette, [meta("1", "a")]);
    assert.ok(e.created.length > 0, "body must create elements (not return early)");
    assert.equal(rows(e).length, 1);
  } finally { e.restore(); }
});

test("lists the metadata it is given: name and preview only", () => {
  const e = env();
  try {
    run(openPalette, [meta("1", "alpha"), meta("2", "beta")]);
    assert.equal(rows(e).length, 2);
    const texts = e.created.filter((x) => x.className === "pv").map((x) => x.textContent);
    assert.deepEqual(texts, ["alpha preview", "beta preview"]);
  } finally { e.restore(); }
});

test("typing sends a snippet-search message to the service worker and shows its result", async () => {
  const e = env({ search: (m) => ({ metas: m.query === "zz" ? [meta("9", "zeta")] : [] }) });
  try {
    run(openPalette, [meta("1", "a")]);
    const input = inputEl(e);
    input.value = "zz";
    input.fire("input");
    await wait(300);
    assert.deepEqual(e.messages, [{ type: "snippet-search", query: "zz" }]);
    assert.equal(rows(e).filter((r) => r.isConnected).length >= 1, true);
    assert.ok(e.created.some((x) => x.textContent === "zeta"));
  } finally { e.restore(); }
});

test("picking a row fetches content by id then inserts it (clipboard fallback with no field focused)", async () => {
  const e = env({ content: (m) => ({ content: `BODY-${m.id}` }) });
  try {
    run(openPalette, [meta("7", "seven")]);
    rows(e)[0].fire("click");
    await wait(50);
    assert.deepEqual(e.messages, [{ type: "snippet-content", id: "7" }]);
    assert.deepEqual(e.copied, ["BODY-7"]);
  } finally { e.restore(); }
});

test("the page never receives snippet content on open (only id, name, tags, preview are used)", () => {
  const e = env();
  try {
    run(openPalette, [{ ...meta("1", "a"), content: "SECRET" }]);
    assert.ok(!e.created.some((x) => x.textContent.includes("SECRET")));
  } finally { e.restore(); }
});

test("copyOnly: picking a snippet never inserts into the focused field, it copies", async () => {
  const field = new FakeEl("textarea");
  field.selectionStart = 0;
  field.selectionEnd = 0;
  const e = env({ focused: field, content: () => ({ content: "BODY" }) });
  try {
    run(openPalette, [meta("7", "seven")], { copyOnly: true });
    rows(e)[0].fire("click");
    await wait(50);
    assert.deepEqual(e.execCalls, []);
    assert.deepEqual(e.copied, ["BODY"]);
  } finally { e.restore(); }
});
test("without copyOnly, a focused text field gets an insert attempt", async () => {
  const field = new FakeEl("textarea");
  field.selectionStart = 0;
  field.selectionEnd = 0;
  field.isConnected = true;
  const e = env({ focused: field, content: () => ({ content: "BODY" }) });
  try {
    run(openPalette, [meta("7", "seven")]);
    rows(e)[0].fire("click");
    await wait(50);
    assert.equal(e.execCalls.length, 1);
    assert.deepEqual(e.execCalls[0], ["insertText", false, "BODY"]);
  } finally { e.restore(); }
});

test("after copying (copyOnly), focus returns to the field/iframe so Ctrl+V lands there", async () => {
  const field = new FakeEl("iframe");
  let focused = 0;
  field.focus = () => { focused++; };
  const e = env({ focused: field, content: () => ({ content: "BODY" }) });
  try {
    run(openPalette, [meta("7", "seven")], { copyOnly: true });
    const before = focused;
    rows(e)[0].fire("click");
    await wait(50);
    assert.deepEqual(e.copied, ["BODY"]);
    assert.ok(focused > before, "target.focus() must be called after the copy");
  } finally { e.restore(); }
});

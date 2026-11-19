import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportJson, exportFilename, parseFile, mergeAdditive, statusLine, restoreList,
} from "../extension/lib/importExport.js";

let n = 0;
const opts = { now: () => 5000, uuid: () => `id${++n}` };
const sn = (name, content = "x", tags = []) => ({ id: "i", name, content, tags, created: 1, modified: 2 });

test("round trip: parseFile(exportJson(x)) equals x including ids", () => {
  const x = [{ ...sn("a", "c1", ["t"]), id: "id-a" }, { ...sn("b", "c2"), id: "id-b" }];
  const r = parseFile(exportJson(x));
  assert.equal(r.ok, true);
  assert.deepEqual(r.snippets, x);
});
test("exportJson has version 1 and keeps the id", () => {
  const o = JSON.parse(exportJson([{ ...sn("a"), id: "id-a" }]));
  assert.equal(o.version, 1);
  assert.equal(o.snippets[0].id, "id-a");
});
test("parseFile: an old export without ids still parses (no id)", () => {
  const r = parseFile('{"version":1,"snippets":[{"name":"a","content":"x","tags":[]}]}');
  assert.equal(r.ok, true);
  assert.equal(r.snippets[0].id, undefined);
});
test("restoreList keeps ids; missing or duplicate ids get a fresh one", () => {
  const incoming = [
    { ...sn("a"), id: "keep-1" }, { ...sn("b"), id: "keep-1" }, { ...sn("c"), id: undefined }, { ...sn("d"), id: "keep-2" },
  ];
  const out = restoreList(incoming, { now: () => 5000, uuid: () => "fresh" });
  assert.deepEqual(out.map((s) => s.id), ["keep-1", "fresh", "fresh", "keep-2"]);
});
test("mergeAdditive: an incoming id that already exists gets a fresh id", () => {
  const existing = [{ ...sn("Foo"), id: "same" }];
  const r = mergeAdditive(existing, [{ ...sn("Bar"), id: "same" }, { ...sn("Baz"), id: "new" }], { now: () => 5000, uuid: () => "fresh" });
  assert.deepEqual(r.snippets.map((s) => s.id), ["same", "fresh", "new"]);
});
test("exportFilename uses local date", () => {
  assert.equal(exportFilename(new Date(2026, 10, 16)), "snippets-2026-11-16.json");
});
for (const [label, text] of [
  ["not json", "nope"],
  ["wrong version", '{"version":2,"snippets":[]}'],
  ["snippets not array", '{"version":1,"snippets":{}}'],
  ["missing content", '{"version":1,"snippets":[{"name":"a","tags":[]}]}'],
  ["tags not array", '{"version":1,"snippets":[{"name":"a","content":"x","tags":"x"}]}'],
  ["empty name", '{"version":1,"snippets":[{"name":"  ","content":"x","tags":[]}]}'],
]) {
  test(`parseFile rejects ${label}`, () => assert.equal(parseFile(text).ok, false));
}
test("parseFile accepts empty list and fills missing times", () => {
  assert.equal(parseFile('{"version":1,"snippets":[]}').ok, true);
  const r = parseFile('{"version":1,"snippets":[{"name":" a ","content":"x","tags":[]}]}');
  assert.equal(r.snippets[0].name, "a");
  assert.equal(r.snippets[0].created, 0);
});
test("mergeAdditive skips existing and in-file duplicates, first wins", () => {
  const existing = [sn("Foo")];
  const incoming = [sn("foo"), sn("Bar", "first"), sn("BAR", "second")];
  const r = mergeAdditive(existing, incoming, opts);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.snippets.map((x) => x.name), ["Foo", "Bar"]);
  assert.equal(r.snippets[1].content, "first");
  assert.equal(typeof r.snippets[1].id, "string");
});
test("mergeAdditive normalises incoming tags against existing", () => {
  const r = mergeAdditive([sn("a", "x", ["Work"])], [sn("b", "y", ["work"])], opts);
  assert.deepEqual(r.snippets[1].tags, ["Work"]);
});
test("mergeAdditive fills zero times with now", () => {
  const r = mergeAdditive([], [{ name: "a", content: "x", tags: [], created: 0, modified: 0 }], opts);
  assert.equal(r.snippets[0].created, 5000);
});
test("statusLine", () => assert.equal(statusLine(1, 3), "1 added, 3 skipped"));
test("restoreList assigns ids, dedupes names first-wins, unifies tag spelling", () => {
  const r = restoreList([sn("a", "1", ["Work"]), sn("A", "2"), sn("b", "3", ["work"])], opts);
  assert.deepEqual(r.map((x) => x.name), ["a", "b"]);
  assert.deepEqual(r[1].tags, ["Work"]);
  assert.ok(r.every((x) => typeof x.id === "string"));
});

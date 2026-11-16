import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportJson, exportFilename, parseFile, mergeAdditive, statusLine, restoreList,
} from "../extension/lib/importExport.js";

let n = 0;
const opts = { now: () => 5000, uuid: () => `id${++n}` };
const sn = (name, content = "x", tags = []) => ({ id: "i", name, content, tags, created: 1, modified: 2 });

test("round trip: parseFile(exportJson(x)) equals x minus ids", () => {
  const x = [sn("a", "c1", ["t"]), sn("b", "c2")];
  const r = parseFile(exportJson(x));
  assert.equal(r.ok, true);
  assert.deepEqual(r.snippets, x.map(({ id, ...rest }) => rest));
});
test("exportJson has version 1 and no id", () => {
  const o = JSON.parse(exportJson([sn("a")]));
  assert.equal(o.version, 1);
  assert.equal(o.snippets[0].id, undefined);
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

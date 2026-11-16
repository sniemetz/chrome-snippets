import { test } from "node:test";
import assert from "node:assert/strict";
import { sortSnippets, filterSnippets, preview } from "../extension/lib/filter.js";

const mk = (name, content = "x", tags = []) => ({ name, content, tags });
const names = (l) => l.map((s) => s.name);

test("sortSnippets orders by name case-insensitively", () => {
  assert.deepEqual(names(sortSnippets([mk("b"), mk("A"), mk("c")])), ["A", "b", "c"]);
});
test("sortSnippets does not mutate input", () => {
  const input = [mk("b"), mk("a")];
  sortSnippets(input);
  assert.deepEqual(names(input), ["b", "a"]);
});
test("query matches content case-insensitively", () => {
  assert.deepEqual(names(filterSnippets([mk("n", "a foo b")], { query: "FOO" })), ["n"]);
});
test("query matches tag", () => {
  assert.deepEqual(names(filterSnippets([mk("n", "x", ["foo"])], { query: "oo" })), ["n"]);
});
test("query matches name", () => {
  assert.deepEqual(names(filterSnippets([mk("Hello")], { query: "ell" })), ["Hello"]);
});
test("regex characters in query are literal", () => {
  const list = [mk("a", "call(x.*("), mk("b", "plain")];
  assert.deepEqual(names(filterSnippets(list, { query: ".*(" })), ["a"]);
});
test("query and tag combine as AND, tag case-insensitive", () => {
  const list = [mk("a", "foo", ["Work"]), mk("b", "foo", ["home"]), mk("c", "bar", ["work"])];
  assert.deepEqual(names(filterSnippets(list, { query: "foo", tag: "work" })), ["a"]);
});
test("empty filter returns all sorted", () => {
  assert.deepEqual(names(filterSnippets([mk("b"), mk("a")], {})), ["a", "b"]);
});
test("preview turns newlines into spaces", () => {
  assert.equal(preview("a\nb\r\nc"), "a b c");
});
test("preview truncates to 60 chars", () => {
  assert.equal(preview("x".repeat(100)).length, 60);
});

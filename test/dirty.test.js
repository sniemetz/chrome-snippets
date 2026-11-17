import { test } from "node:test";
import assert from "node:assert/strict";
import { formsEqual } from "../extension/lib/dirty.js";

const f = (o = {}) => ({ name: "n", content: "c", tags: ["a", "b"], ...o });

test("identical forms are equal", () => assert.equal(formsEqual(f(), f()), true));
test("changed name is not equal", () => assert.equal(formsEqual(f(), f({ name: "n2" })), false));
test("changed content is not equal", () => assert.equal(formsEqual(f(), f({ content: "c2" })), false));
test("changed tag order is not equal", () => assert.equal(formsEqual(f(), f({ tags: ["b", "a"] })), false));
test("extra tag is not equal", () => assert.equal(formsEqual(f(), f({ tags: ["a", "b", "c"] })), false));

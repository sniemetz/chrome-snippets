import { test } from "node:test";
import assert from "node:assert/strict";
import { viewFromSearch } from "../extension/lib/view.js";

test("?view=window selects the window view", () => assert.equal(viewFromSearch("?view=window"), "window"));
test("no parameter selects the toolbar view", () => assert.equal(viewFromSearch(""), "toolbar"));
test("unknown value falls back to the toolbar view", () => assert.equal(viewFromSearch("?view=other"), "toolbar"));
test("other parameters are ignored", () => assert.equal(viewFromSearch("?x=1&view=window"), "window"));

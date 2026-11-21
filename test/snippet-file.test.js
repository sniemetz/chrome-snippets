import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSnippetFile, FolderReadError } from "../extension/lib/snippet-file.js";

const ID = "11111111-2222-3333-4444-555555555555";
const sn = (id = ID, o = {}) => ({ id, name: "n", content: "c", tags: ["t"], created: 1, modified: 2, ...o });
const body = (o = {}) => JSON.stringify({ version: 1, ...sn(), ...o });

test("parseSnippetFile rejects bad input", () => {
  assert.throws(() => parseSnippetFile("not json"), FolderReadError);
  assert.throws(() => parseSnippetFile(body({ version: 2 })), FolderReadError);
  assert.throws(() => parseSnippetFile(JSON.stringify({ version: 1, id: ID, content: "c", tags: [], created: 1, modified: 2 })), FolderReadError);
  assert.throws(() => parseSnippetFile(body({ tags: "a" })), FolderReadError);
  assert.throws(() => parseSnippetFile(body({ name: "   " })), FolderReadError);
  assert.deepEqual(parseSnippetFile(body()), sn());
});

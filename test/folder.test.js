import { test } from "node:test";
import assert from "node:assert/strict";
import { createFolder, parseSnippetFile, FolderReadError } from "../extension/lib/folder.js";
import { fakeDir } from "./helpers/fake-dir.js";

const ID = "11111111-2222-3333-4444-555555555555";
const ID2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const sn = (id = ID, o = {}) => ({ id, name: "n", content: "c", tags: ["t"], created: 1, modified: 2, ...o });
const body = (o = {}) => JSON.stringify({ version: 1, ...sn(), ...o });

test("list ignores non-matching names, subfolders and non-json files; reads no content", async () => {
  const dir = fakeDir();
  dir.files.set(`${ID}.json`, { text: body(), lastModified: 7 });
  dir.files.set("notes.txt", { text: "x", lastModified: 1 });
  dir.files.set(`${ID}.json.conflict`, { text: "x", lastModified: 1 });
  dir.files.set("readme.json", { text: "{}", lastModified: 1 });
  dir.dirs.add(ID2 + ".json");
  const list = await createFolder(dir).list();
  assert.deepEqual(list.map((x) => ({ id: x.id, fileModified: x.fileModified })), [{ id: ID, fileModified: 7 }]);
  assert.equal(typeof list[0].size, "number");
  assert.deepEqual(dir.spy.textCalls, []);
});
test("read returns the snippet", async () => {
  const dir = fakeDir();
  dir.files.set(`${ID}.json`, { text: body(), lastModified: 7 });
  assert.deepEqual(await createFolder(dir).read(ID), sn());
});
test("read: corrupt, wrong-version, missing or id-mismatched file throws FolderReadError", async () => {
  const dir = fakeDir();
  const f = createFolder(dir);
  dir.files.set(`${ID}.json`, { text: "{nope", lastModified: 1 });
  await assert.rejects(f.read(ID), FolderReadError);
  dir.files.set(`${ID}.json`, { text: body({ version: 2 }), lastModified: 1 });
  await assert.rejects(f.read(ID), FolderReadError);
  dir.files.set(`${ID}.json`, { text: body({ id: ID2 }), lastModified: 1 });
  await assert.rejects(f.read(ID), FolderReadError);
  await assert.rejects(f.read(ID2), FolderReadError);
});
test("write then read round-trips and returns fileModified", async () => {
  const dir = fakeDir();
  const f = createFolder(dir);
  const { fileModified } = await f.write(sn());
  assert.equal(typeof fileModified, "number");
  assert.deepEqual(await f.read(ID), sn());
  assert.equal((await f.list())[0].fileModified, fileModified);
  assert.equal(JSON.parse(dir.files.get(`${ID}.json`).text).version, 1);
});
test("remove of a missing file does not throw; remove deletes an existing one", async () => {
  const dir = fakeDir();
  const f = createFolder(dir);
  await f.remove(ID);
  await f.write(sn());
  await f.remove(ID);
  assert.equal(dir.files.size, 0);
});
test("permission passes through the handle", async () => {
  const dir = fakeDir({ permission: "prompt" });
  assert.equal(await createFolder(dir).permission(), "prompt");
});
test("parseSnippetFile rejects bad input", () => {
  assert.throws(() => parseSnippetFile("not json"), FolderReadError);
  assert.throws(() => parseSnippetFile(body({ version: 2 })), FolderReadError);
  assert.throws(() => parseSnippetFile(JSON.stringify({ version: 1, id: ID, content: "c", tags: [], created: 1, modified: 2 })), FolderReadError);
  assert.throws(() => parseSnippetFile(body({ tags: "a" })), FolderReadError);
  assert.deepEqual(parseSnippetFile(body()), sn());
});

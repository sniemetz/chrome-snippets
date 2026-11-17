import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../extension/", import.meta.url);
const manifest = () => JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));

test("permissions are exactly the six from the spec", () => {
  assert.deepEqual([...manifest().permissions].sort(), [
    "activeTab", "clipboardWrite", "contextMenus", "scripting", "storage", "unlimitedStorage",
  ]);
});

test("no host permissions and no content scripts", () => {
  assert.equal(manifest().host_permissions, undefined);
  assert.equal(manifest().content_scripts, undefined);
});

test("commands exist and have no default keys", () => {
  const { commands } = manifest();
  assert.ok(commands._execute_action);
  assert.ok(commands["open-palette"]);
  assert.equal(commands._execute_action.suggested_key, undefined);
  assert.equal(commands["open-palette"].suggested_key, undefined);
});

test("wiring: service worker module and popup", () => {
  const m = manifest();
  assert.equal(m.background.service_worker, "background/sw.js");
  assert.equal(m.background.type, "module");
  assert.equal(m.action.default_popup, "popup/popup.html");
});

for (const size of [16, 32, 48, 128]) {
  test(`icon${size}.png is a PNG of ${size}x${size}`, () => {
    const buf = readFileSync(new URL(`icons/icon${size}.png`, root));
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(buf.readUInt32BE(16), size);
    assert.equal(buf.readUInt32BE(20), size);
  });
}

test("minimum Chrome is 102 or higher (chrome.storage.session)", () => {
  assert.ok(Number(manifest().minimum_chrome_version) >= 102);
});

test("optional host permissions for http(s) only; no required host permissions", () => {
  const m = manifest();
  assert.equal(m.host_permissions, undefined);
  assert.deepEqual(m.optional_host_permissions, ["https://*/*", "http://*/*"]);
});

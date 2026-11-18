// In-memory File System Access directory handle for tests.
export function fakeDir({ permission = "granted" } = {}) {
  const files = new Map(); // name -> { text, lastModified }
  const dirs = new Set();
  const spy = { textCalls: [] };
  let clock = 1000;
  const fileHandle = (name) => ({
    kind: "file", name,
    async getFile() {
      const f = files.get(name);
      if (!f) throw new DOMException("not found", "NotFoundError");
      return { lastModified: f.lastModified, size: f.text.length, async text() { spy.textCalls.push(name); return f.text; } };
    },
    async createWritable() {
      let buf = "";
      return {
        async write(t) { buf += t; },
        async close() { files.set(name, { text: buf, lastModified: ++clock }); },
      };
    },
  });
  const handle = {
    name: "fake",
    files, dirs, spy,
    setPermission(p) { permission = p; },
    async queryPermission() { return permission; },
    async *values() {
      for (const n of dirs) yield { kind: "directory", name: n };
      for (const n of files.keys()) yield fileHandle(n);
    },
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) throw new DOMException("not found", "NotFoundError");
        files.set(name, { text: "", lastModified: ++clock });
      }
      return fileHandle(name);
    },
    async removeEntry(name) {
      if (!files.has(name)) throw new DOMException("not found", "NotFoundError");
      files.delete(name);
    },
  };
  return handle;
}

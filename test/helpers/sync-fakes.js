import { createStore } from "../../extension/lib/store.js";
import { createSyncState } from "../../extension/lib/sync-state.js";
import { FolderReadError } from "../../extension/lib/folder.js";
import { memArea } from "./mem-area.js";

export const sn = (id, o = {}) => ({ id, name: id, content: `content-${id}`, tags: [], created: 1, modified: 1, ...o });

// In-memory Folder (same interface as createFolder) with call logs and failure injection.
export function fakeFolder(initial = []) {
  let clock = 100;
  const files = new Map(); // id -> { snippet, fileModified, unreadable }
  const f = {
    files,
    calls: { read: [], write: [], remove: [] },
    perm: "granted",
    permChecks: 0,
    permLostAfter: null, // number of permission() calls that still succeed
    failWriteOn: null,
    listFails: false,
    put(snippet, { unreadable = false } = {}) {
      files.set(snippet.id, { snippet: structuredClone(snippet), fileModified: ++clock, unreadable });
    },
    async permission() {
      f.permChecks++;
      if (f.permLostAfter !== null && f.permChecks > f.permLostAfter) return "prompt";
      return f.perm;
    },
    async list() {
      if (f.listFails) throw new FolderReadError("list failed");
      return [...files].map(([id, v]) => ({ id, fileModified: v.fileModified, size: 1 }));
    },
    async read(id) {
      f.calls.read.push(id);
      const v = files.get(id);
      if (!v || v.unreadable) throw new FolderReadError("unreadable");
      return structuredClone(v.snippet);
    },
    async write(snippet) {
      f.calls.write.push(snippet.id);
      if (f.failWriteOn === snippet.id) throw new Error("disk full");
      f.put(snippet);
      return { fileModified: files.get(snippet.id).fileModified };
    },
    async remove(id) {
      f.calls.remove.push(id);
      files.delete(id);
    },
  };
  for (const s of initial) f.put(s);
  return f;
}

export async function setup({ local = [], files = [], intervalNow = 5000 } = {}) {
  let t = 1000, n = 0;
  const area = memArea();
  const store = createStore(area, { now: () => t++, uuid: () => `gen${++n}` });
  await store.upsertMany(local);
  area.gets.length = 0;
  const folder = fakeFolder(files);
  const state = createSyncState(area);
  const now = () => intervalNow;
  return { area, store, folder, state, now };
}

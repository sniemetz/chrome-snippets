import { normalizeTags, allTags } from "./tags.js";
import { preview, sortSnippets } from "./filter.js";

// Storage layout (chrome.storage.local):
//   "meta"   -> [{ id, name, tags, preview, created, modified }]
//   "c:<id>" -> content string
// Content is read only to edit (get), paste (get) or search (search), never to list.
const META = "meta";
const ck = (id) => `c:${id}`;
const CHUNK = 25;
const lc = (s) => s.toLowerCase();

export class StoreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

const toMeta = (s) => ({
  id: s.id, name: s.name, tags: s.tags, preview: preview(s.content), created: s.created, modified: s.modified,
});

export function createStore(
  area = globalThis.chrome?.storage?.local,
  { now = Date.now, uuid = () => crypto.randomUUID() } = {},
) {
  const readMeta = async () => (await area.get(META))[META] ?? [];

  function validate(metas, { name, content, tags }, selfId) {
    const n = String(name ?? "").trim();
    if (!n) throw new StoreError("NAME_REQUIRED");
    if (!content) throw new StoreError("CONTENT_REQUIRED");
    const lower = lc(n);
    if (metas.some((m) => m.id !== selfId && lc(m.name) === lower)) throw new StoreError("DUPLICATE_NAME");
    return { name: n, content, tags: normalizeTags(tags ?? [], allTags(metas)) };
  }

  // Reads content for ids in bounded chunks; calls visit(id, content) and keeps nothing.
  async function scanContent(ids, visit) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const got = await area.get(slice.map(ck));
      for (const id of slice) visit(id, got[ck(id)] ?? "");
    }
  }

  return {
    listMeta: readMeta,

    // Full snippets. Reads ALL content: used only by Export.
    async list() {
      const metas = await readMeta();
      const content = new Map();
      await scanContent(metas.map((m) => m.id), (id, c) => content.set(id, c));
      return metas.map((m) => ({ id: m.id, name: m.name, content: content.get(m.id), tags: m.tags, created: m.created, modified: m.modified }));
    },

    async get(id) {
      const got = await area.get([META, ck(id)]);
      const m = (got[META] ?? []).find((x) => x.id === id);
      if (!m) return undefined;
      return { id: m.id, name: m.name, content: got[ck(id)] ?? "", tags: m.tags, created: m.created, modified: m.modified };
    },

    async search({ query = "", tag = "" } = {}) {
      const metas = await readMeta();
      const t = lc(tag);
      const q = lc(query);
      const pool = metas.filter((m) => !t || m.tags.some((x) => lc(x) === t));
      if (!q) return sortSnippets(pool);
      const hit = new Set();
      const rest = [];
      for (const m of pool) {
        if (lc(m.name).includes(q) || m.tags.some((x) => lc(x).includes(q))) hit.add(m.id);
        else rest.push(m.id);
      }
      await scanContent(rest, (id, c) => { if (lc(c).includes(q)) hit.add(id); });
      return sortSnippets(pool.filter((m) => hit.has(m.id)));
    },

    async add(input) {
      const metas = await readMeta();
      const t = now();
      const snippet = { id: uuid(), ...validate(metas, input), created: t, modified: t };
      await area.set({ [META]: [...metas, toMeta(snippet)], [ck(snippet.id)]: snippet.content });
      return snippet;
    },

    async update(id, input) {
      const metas = await readMeta();
      const i = metas.findIndex((m) => m.id === id);
      if (i < 0) throw new StoreError("NOT_FOUND");
      const updated = { id, created: metas[i].created, ...validate(metas, input, id), modified: now() };
      metas[i] = toMeta(updated);
      await area.set({ [META]: metas, [ck(id)]: updated.content });
      return updated;
    },

    async remove(id) {
      await area.set({ [META]: (await readMeta()).filter((m) => m.id !== id) });
      await area.remove(ck(id));
    },

    async replaceAll(snippets) {
      const old = await readMeta();
      const entries = { [META]: snippets.map(toMeta) };
      for (const s of snippets) entries[ck(s.id)] = s.content;
      await area.set(entries);
      const keep = new Set(snippets.map((s) => s.id));
      const orphans = old.filter((m) => !keep.has(m.id)).map((m) => ck(m.id));
      if (orphans.length) await area.remove(orphans);
    },

    async addMany(snippets) {
      const entries = { [META]: [...(await readMeta()), ...snippets.map(toMeta)] };
      for (const s of snippets) entries[ck(s.id)] = s.content;
      await area.set(entries);
    },
  };
}

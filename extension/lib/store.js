import { normalizeTags, allTags } from "./tags.js";

const KEY = "snippets";

export class StoreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export function createStore(
  area = globalThis.chrome?.storage?.local,
  { now = Date.now, uuid = () => crypto.randomUUID() } = {},
) {
  const read = async () => (await area.get(KEY))[KEY] ?? [];
  const write = (list) => area.set({ [KEY]: list });

  function validate(list, { name, content, tags }, selfId) {
    const n = String(name ?? "").trim();
    if (!n) throw new StoreError("NAME_REQUIRED");
    if (!content) throw new StoreError("CONTENT_REQUIRED");
    const lower = n.toLowerCase();
    if (list.some((s) => s.id !== selfId && s.name.toLowerCase() === lower)) {
      throw new StoreError("DUPLICATE_NAME");
    }
    return { name: n, content, tags: normalizeTags(tags ?? [], allTags(list)) };
  }

  return {
    list: read,
    async get(id) {
      return (await read()).find((s) => s.id === id);
    },
    async add(input) {
      const list = await read();
      const t = now();
      const snippet = { id: uuid(), ...validate(list, input), created: t, modified: t };
      await write([...list, snippet]);
      return snippet;
    },
    async update(id, input) {
      const list = await read();
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) throw new StoreError("NOT_FOUND");
      const updated = { ...list[i], ...validate(list, input, id), modified: now() };
      list[i] = updated;
      await write(list);
      return updated;
    },
    async remove(id) {
      await write((await read()).filter((s) => s.id !== id));
    },
    replaceAll: (snippets) => write(snippets),
    async addMany(snippets) {
      await write([...(await read()), ...snippets]);
    },
  };
}

// File System Access wrapper: a folder of <uuid>.json snippet files. Other entries are ignored.
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

export class FolderReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "FolderReadError";
  }
}

export function parseSnippetFile(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new FolderReadError("not JSON"); }
  if (!o || typeof o !== "object" || o.version !== 1) throw new FolderReadError("unsupported version");
  const strOk = typeof o.id === "string" && typeof o.name === "string" && typeof o.content === "string";
  const tagsOk = Array.isArray(o.tags) && o.tags.every((t) => typeof t === "string");
  const numOk = Number.isFinite(o.created) && Number.isFinite(o.modified);
  if (!strOk || !tagsOk || !numOk) throw new FolderReadError("invalid fields");
  return { id: o.id, name: o.name, content: o.content, tags: o.tags, created: o.created, modified: o.modified };
}

export function createFolder(dir) {
  const fileName = (id) => `${id}.json`;
  return {
    permission: () => dir.queryPermission({ mode: "readwrite" }),

    // Metadata only; never reads content. A listing failure throws (a file we cannot stat must not look deleted).
    async list() {
      const out = [];
      try {
        for await (const e of dir.values()) {
          if (e.kind !== "file" || !NAME_RE.test(e.name)) continue;
          const f = await e.getFile();
          out.push({ id: e.name.slice(0, -5), fileModified: f.lastModified, size: f.size });
        }
      } catch (err) {
        throw new FolderReadError(`list failed: ${err?.message ?? err}`);
      }
      return out;
    },

    async read(id) {
      let text;
      try {
        text = await (await (await dir.getFileHandle(fileName(id))).getFile()).text();
      } catch (err) {
        throw new FolderReadError(`read failed: ${err?.message ?? err}`);
      }
      const sn = parseSnippetFile(text);
      if (sn.id !== id) throw new FolderReadError("id does not match file name");
      return sn;
    },

    async write(sn) {
      const h = await dir.getFileHandle(fileName(sn.id), { create: true });
      const w = await h.createWritable();
      await w.write(JSON.stringify({ version: 1, id: sn.id, name: sn.name, content: sn.content, tags: sn.tags, created: sn.created, modified: sn.modified }, null, 2));
      await w.close();
      return { fileModified: (await h.getFile()).lastModified };
    },

    async remove(id) {
      try {
        await dir.removeEntry(fileName(id));
      } catch (err) {
        if (err?.name !== "NotFoundError") throw err;
      }
    },
  };
}

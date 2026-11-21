// Snippet file format (<uuid>.json) shared by the sync backend and the engine.

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
  if (strOk && !o.name.trim()) throw new FolderReadError("empty name");
  const tagsOk = Array.isArray(o.tags) && o.tags.every((t) => typeof t === "string");
  const numOk = Number.isFinite(o.created) && Number.isFinite(o.modified);
  if (!strOk || !tagsOk || !numOk) throw new FolderReadError("invalid fields");
  return { id: o.id, name: o.name, content: o.content, tags: o.tags, created: o.created, modified: o.modified };
}

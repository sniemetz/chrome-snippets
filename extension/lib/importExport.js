import { normalizeTags, allTags } from "./tags.js";

export function exportJson(snippets) {
  const out = snippets.map(({ id, name, content, tags, created, modified }) => ({
    id, name, content, tags, created, modified,
  }));
  return JSON.stringify({ version: 1, snippets: out }, null, 2);
}

export function exportFilename(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `snippets-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

export function parseFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: "File is not valid JSON" };
  }
  if (!obj || obj.version !== 1) return { ok: false, error: "Unsupported file version" };
  if (!Array.isArray(obj.snippets)) return { ok: false, error: "File has no snippet list" };
  const snippets = [];
  for (const [i, e] of obj.snippets.entries()) {
    const bad = (why) => ({ ok: false, error: `Entry ${i + 1}: ${why}` });
    if (!e || typeof e !== "object") return bad("not an object");
    if (typeof e.name !== "string" || !e.name.trim()) return bad("name missing");
    if (typeof e.content !== "string" || !e.content) return bad("content missing");
    if (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== "string")) return bad("tags must be a list of text");
    snippets.push({
      ...(typeof e.id === "string" && e.id ? { id: e.id } : {}),
      name: e.name.trim(),
      content: e.content,
      tags: e.tags,
      created: Number.isFinite(e.created) ? e.created : 0,
      modified: Number.isFinite(e.modified) ? e.modified : 0,
    });
  }
  return { ok: true, snippets };
}

// Keeps an entry's own id (so sync sees the same snippet again) unless it is missing or already taken.
function build(entries, known, { now, uuid }, takenIds = new Set()) {
  const t = now();
  return entries.map((e) => {
    const id = e.id && !takenIds.has(e.id) ? e.id : uuid();
    takenIds.add(id);
    return {
      id,
      name: e.name,
      content: e.content,
      tags: normalizeTags(e.tags, known),
      created: e.created || t,
      modified: e.modified || t,
    };
  });
}

function dedupe(entries, taken) {
  const seen = new Set(taken);
  const kept = [];
  let skipped = 0;
  for (const e of entries) {
    const k = e.name.toLowerCase();
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    kept.push(e);
  }
  return { kept, skipped };
}

export function mergeAdditive(existing, incoming, opts) {
  const { kept, skipped } = dedupe(incoming, existing.map((s) => s.name.toLowerCase()));
  const known = allTags(existing);
  const added = build(kept, known, opts, new Set(existing.map((s) => s.id)));
  // tags added by earlier incoming entries also set spelling for later ones
  const all = [...existing];
  for (const s of added) {
    s.tags = normalizeTags(s.tags, allTags(all));
    all.push(s);
  }
  return { snippets: all, added: added.length, skipped };
}

export function restoreList(incoming, opts) {
  const { kept } = dedupe(incoming, []);
  const out = [];
  for (const s of build(kept, [], opts)) {
    s.tags = normalizeTags(s.tags, allTags(out));
    out.push(s);
  }
  return out;
}

export const statusLine = (added, skipped) => `${added} added, ${skipped} skipped`;

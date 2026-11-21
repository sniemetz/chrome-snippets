const key = (t) => t.toLowerCase();

export function normalizeTags(input, known) {
  const spelling = new Map();
  for (const k of known) if (!spelling.has(key(k))) spelling.set(key(k), k);
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const t = String(raw).trim();
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(spelling.get(key(t)) ?? t);
  }
  return out;
}

export function allTags(snippets) {
  const map = new Map();
  for (const s of snippets) for (const t of s.tags) if (!map.has(key(t))) map.set(key(t), t);
  return [...map.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

// [{ tag, count }] sorted case-insensitively; count = snippets that carry the tag.
export function tagCounts(snippets) {
  const map = new Map();
  for (const s of snippets) {
    const seen = new Set();
    for (const t of s.tags) {
      const k = key(t);
      if (seen.has(k)) continue;
      seen.add(k);
      const e = map.get(k);
      if (e) e.count++;
      else map.set(k, { tag: t, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => key(a.tag).localeCompare(key(b.tag)));
}

// Tag suggestions for the tag field: substring match (case-insensitive) on 1+ typed chars, tags already on the
// snippet left out, prefix matches first. `all` is already sorted (allTags), so each group stays alphabetical.
export function suggestTags(all, current, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const have = new Set(current.map(key));
  const hits = all.filter((t) => !have.has(key(t)) && key(t).includes(q));
  return [...hits.filter((t) => key(t).startsWith(q)), ...hits.filter((t) => !key(t).startsWith(q))];
}

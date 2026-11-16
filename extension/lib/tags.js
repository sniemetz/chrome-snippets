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

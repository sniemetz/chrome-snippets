const lc = (s) => s.toLowerCase();

export function sortSnippets(snippets) {
  return [...snippets].sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
}

export function filterSnippets(snippets, { query = "", tag = "" } = {}) {
  const q = lc(query);
  const t = lc(tag);
  const out = snippets.filter((s) => {
    if (t && !s.tags.some((x) => lc(x) === t)) return false;
    if (!q) return true;
    return lc(s.name).includes(q) || lc(s.content).includes(q) || s.tags.some((x) => lc(x).includes(q));
  });
  return sortSnippets(out);
}

export function preview(content, max = 60) {
  return content.replace(/\r\n|\r|\n/g, " ").slice(0, max);
}

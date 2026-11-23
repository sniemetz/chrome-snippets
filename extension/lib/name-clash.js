// Deterministic decision for two snippets with the same name (case-insensitive) but different ids.
// takenNames: Set of lower-cased names in use. Result does not depend on argument order.
export function decideClash(a, b, takenNames) {
  const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
  if (a.content === b.content) return { kind: "same", keep: lo.id, drop: hi.id };
  let n = 2;
  while (takenNames.has(`${hi.name} (${n})`.toLowerCase())) n++;
  return { kind: "rename", id: hi.id, newName: `${hi.name} (${n})` };
}

// Name for a new snippet: the trimmed name if free (case-insensitive), else "Name (2)", "Name (3)", ... first free.
export function freeName(name, existingNames) {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const base = String(name ?? "").trim();
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

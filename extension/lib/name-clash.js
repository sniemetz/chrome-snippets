// Deterministic decision for two snippets with the same name (case-insensitive) but different ids.
// takenNames: Set of lower-cased names in use. Result does not depend on argument order.
export function decideClash(a, b, takenNames) {
  const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
  if (a.content === b.content) return { kind: "same", keep: lo.id, drop: hi.id };
  let n = 2;
  while (takenNames.has(`${hi.name} (${n})`.toLowerCase())) n++;
  return { kind: "rename", id: hi.id, newName: `${hi.name} (${n})` };
}

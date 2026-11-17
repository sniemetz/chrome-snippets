// Compares editor forms: used to enable Save only when something changed.
export function formsEqual(a, b) {
  return (
    a.name === b.name &&
    a.content === b.content &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i])
  );
}

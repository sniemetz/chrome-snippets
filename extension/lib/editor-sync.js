// What to do with the open editor when storage changed underneath it (e.g. a sync pull).
// loaded: meta of the snippet as the editor loaded it; current: its meta now (undefined = deleted).
export function classifyExternalChange(loaded, current, dirty) {
  if (!current) return "notice-deleted";
  if (current.modified === loaded.modified) return "none";
  return dirty ? "notice-changed" : "refresh";
}

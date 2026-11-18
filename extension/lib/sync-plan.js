// Pure sync planner: decides actions from local metas, folder listing and the last-synced record.
// local: [{id, modified}], folder: [{id, fileModified}], synced: {[id]: {modified, fileModified}}
export function planSync({ local, folder, synced, firstLink = false }) {
  const L = new Map(local.map((m) => [m.id, m]));
  const F = new Map(folder.map((m) => [m.id, m]));
  const ids = new Set([...L.keys(), ...F.keys(), ...Object.keys(synced)]);
  const actions = [];
  const add = (type, id) => actions.push({ type, id });

  for (const id of ids) {
    const l = L.get(id), f = F.get(id), s = synced[id];
    if (firstLink) {
      if (l && f) add("conflict", id);
      else if (l) add("push", id);
      else if (f) add("pull", id);
      continue;
    }
    if (l && f) {
      if (!s) { add("conflict", id); continue; }
      const lc = l.modified !== s.modified;
      const fc = f.fileModified !== s.fileModified;
      if (lc && fc) add("conflict", id);
      else if (lc) add("push", id);
      else if (fc) add("pull", id);
    } else if (l) {
      if (!s) add("push", id);
      else add(l.modified !== s.modified ? "push" : "deleteLocal", id);
    } else if (f) {
      if (!s) add("pull", id);
      else add(f.fileModified !== s.fileModified ? "pull" : "deleteFile", id);
    } else if (s) add("forget", id);
  }

  const conflicts = actions.filter((a) => a.type === "deleteLocal" || a.type === "deleteFile" || a.type === "conflict").length;
  const threshold = Math.max(5, 0.2 * Math.max(local.length, folder.length));
  let reason = null;
  if (!firstLink) {
    const hasHistory = Object.keys(synced).length > 0;
    if (hasHistory && folder.length === 0 && local.length > 0) reason = "folder-empty";
    else if (hasHistory && local.length === 0 && folder.length > 0) reason = "local-empty";
    else if (conflicts > threshold) reason = "count";
  }
  return { actions, guard: { tripped: reason !== null, conflicts, threshold, reason } };
}

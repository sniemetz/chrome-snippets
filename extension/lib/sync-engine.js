import { planSync } from "./sync-plan.js";
import { decideClash } from "./name-clash.js";
import { FolderReadError } from "./snippet-file.js";

const lc = (s) => s.toLowerCase();
const SAVE_EVERY = 25; // persist `synced` this often, so a stopped run does not look like mass conflicts
const emptyCounts = () => ({ pushed: 0, pulled: 0, deletedLocal: 0, deletedFiles: 0, renamed: 0, skipped: 0 });

// One sync run. store/folder/state are interfaces (see store.js, dropbox.js, sync-state.js); "folder" is the remote side.
export async function runSync({ store, folder, state, now = Date.now, resolve = null, firstLink = false }) {
  const counts = emptyCounts();
  const st = await state.get();
  const synced = { ...(firstLink ? {} : st.synced) };
  const pausedMsg = folder.pausedMessage ?? "Folder access must be re-allowed";
  const isAuthLost = (err) => err?.name === "DropboxAuthError"; // matched by name: the engine stays adapter-agnostic

  if ((await folder.permission()) !== "granted") {
    await state.set({ status: "paused", message: pausedMsg });
    return { status: "paused", counts, summary: null };
  }

  let summary = null;
  let status = "ok";
  let done = 0;
  let message = "";
  try {
    const listing = await folder.list();
    const fileMod = new Map(listing.map((f) => [f.id, f.fileModified]));
    const metas = await store.listMeta();
    const byId = new Map(metas.map((m) => [m.id, m]));
    const plan = planSync({
      local: metas.map((m) => ({ id: m.id, modified: m.modified })),
      folder: listing, synced, firstLink,
    });

    if (plan.guard.tripped && !resolve) {
      const { conflicts, threshold, reason } = plan.guard;
      await state.set({ status: "needs-decision", message: "", decision: { conflicts, threshold, reason } });
      return { status: "needs-decision", counts, summary: null };
    }

    const record = (sn, fileModified) => { synced[sn.id] = { modified: sn.modified, fileModified }; };

    // Pull one snippet, resolving a name clash with a different local snippet (spec 6.5).
    async function pull(sn, fileModified) {
      const other = [...byId.values()].find((m) => m.id !== sn.id && lc(m.name) === lc(sn.name));
      if (!other) {
        await store.upsertMany([sn]);
        byId.set(sn.id, { ...sn });
        record(sn, fileModified);
        counts.pulled++;
        return;
      }
      const otherFull = await store.get(other.id);
      const taken = new Set([...byId.values()].map((m) => lc(m.name)));
      const d = decideClash(sn, otherFull, taken);
      if (d.kind === "same") {
        if (d.keep === sn.id) {
          await store.upsertMany([sn]);
          await store.removeMany([other.id]);
          await folder.remove(other.id);
          byId.delete(other.id);
          delete synced[other.id];
          byId.set(sn.id, { ...sn });
          record(sn, fileModified);
          counts.pulled++;
        } else {
          await store.removeMany([sn.id]);
          await folder.remove(sn.id);
          byId.delete(sn.id);
          delete synced[sn.id];
        }
        return;
      }
      counts.renamed++;
      if (d.id === sn.id) {
        const renamed = { ...sn, name: d.newName, modified: now() };
        await store.upsertMany([renamed]);
        byId.set(renamed.id, { ...renamed });
        const w = await folder.write(renamed);
        record(renamed, w.fileModified);
        counts.pulled++;
      } else {
        const renamed = { ...otherFull, name: d.newName, modified: now() };
        await store.upsertMany([renamed, sn]);
        byId.set(renamed.id, { ...renamed });
        byId.set(sn.id, { ...sn });
        const w = await folder.write(renamed);
        record(renamed, w.fileModified);
        record(sn, fileModified);
        counts.pulled++;
      }
    }

    async function push(id) {
      const sn = await store.get(id);
      if (!sn) return;
      const w = await folder.write(sn);
      record(sn, w.fileModified);
      counts.pushed++;
    }

    async function conflict(id) {
      const file = await folder.read(id);
      const local = await store.get(id);
      if (!local) return pull(file, fileMod.get(id));
      if (file.modified > local.modified) return pull(file, fileMod.get(id));
      const same = file.modified === local.modified && file.name === local.name && file.content === local.content
        && file.tags.join("\u0000") === local.tags.join("\u0000");
      if (same) { record(local, fileMod.get(id)); return; }
      return push(id);
    }

    for (const a of plan.actions) {
      if ((await folder.permission()) !== "granted") { status = "paused"; message = pausedMsg; break; }
      try {
        let type = a.type;
        if (plan.guard.tripped) {
          if (resolve === "folder" && (type === "deleteFile" || type === "conflict")) type = "pull";
          else if (resolve === "local" && (type === "deleteLocal" || type === "conflict")) type = "push";
        }
        if (type === "push") await push(a.id);
        else if (type === "pull") await pull(await folder.read(a.id), fileMod.get(a.id));
        else if (type === "conflict") await conflict(a.id);
        else if (type === "deleteLocal") { await store.removeMany([a.id]); byId.delete(a.id); delete synced[a.id]; counts.deletedLocal++; }
        else if (type === "deleteFile") { await folder.remove(a.id); delete synced[a.id]; counts.deletedFiles++; }
        else if (type === "forget") delete synced[a.id];
        done++;
      } catch (err) {
        // One bad file never stops the run, but a lost permission does (it also explains a failed write).
        if (isAuthLost(err) || (await folder.permission()) !== "granted") { status = "paused"; message = pausedMsg; break; }
        if (!(err instanceof FolderReadError)) console.warn("Sync: skipped", a.id, err);
        counts.skipped++;
      }
      if (done % SAVE_EVERY === 0 && done > 0) await state.set({ synced });
    }

    if (firstLink && status === "ok") {
      summary = `${counts.pulled} added from Dropbox, ${counts.pushed} pushed` + (counts.renamed ? `, ${counts.renamed} renamed` : "");
    }
    if (status === "ok" && counts.skipped) message = `${counts.skipped} files could not be synced, will retry`;
  } catch (err) {
    if (isAuthLost(err)) { status = "paused"; message = pausedMsg; }
    else { status = "error"; message = String(err?.message ?? err); }
  }

  await state.set({
    status, message, synced, decision: null, lastSync: status === "ok" ? now() : st.lastSync,
    ...(firstLink && status === "ok" ? { summary } : {}),
  });
  return { status, counts, summary };
}

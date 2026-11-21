// Dropbox app-folder adapter with the same shape as createFolder (lib/folder.js).
import { parseSnippetFile, FolderReadError } from "./folder.js";
import { DropboxAuthError } from "./dropbox-auth.js";

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

class DropboxHttpError extends Error {
  constructor(status, body) {
    super(`Dropbox request failed (${status})`);
    this.name = "DropboxHttpError";
    this.status = status;
    this.body = body;
  }
}

export function createDropbox({ fetch, auth, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const path = (id) => `/${id}.json`;

  // One request with the retry rules: 401 -> force-refresh once; 429 -> wait Retry-After once;
  // 5xx / network error -> retry once. DropboxAuthError from auth propagates unchanged.
  async function call(url, { headers = {}, body } = {}) {
    let refreshed = false, rateLimited = false, retried = false;
    let token = await auth.accessToken();
    for (;;) {
      let res;
      try {
        res = await fetch(url, { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body });
      } catch (err) {
        if (retried) throw err;
        retried = true;
        continue;
      }
      if (res.ok) return res;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await auth.accessToken({ force: true });
        continue;
      }
      if (res.status === 429 && !rateLimited) {
        rateLimited = true;
        const raw = res.headers?.get?.("Retry-After");
        const secs = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
        await sleep((Number.isFinite(secs) && secs >= 0 ? secs : 1) * 1000);
        continue;
      }
      if (res.status >= 500 && !retried) {
        retried = true;
        continue;
      }
      let text = "";
      try { text = await res.text(); } catch { /* ignore */ }
      throw new DropboxHttpError(res.status, text);
    }
  }
  // No-argument RPC endpoints take no body and no Content-Type.
  const rpc = (endpoint, payload) => payload === undefined
    ? call(`${API}${endpoint}`)
    : call(`${API}${endpoint}`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const asRead = (err, what) => {
    if (err instanceof DropboxAuthError || err instanceof FolderReadError) return err;
    return new FolderReadError(`${what} failed: ${err?.message ?? err}`);
  };

  return {
    pausedMessage: "Sign in to Dropbox again",

    // Local check only: no network.
    async permission() { return (await auth.hasLink()) ? "granted" : "denied"; },

    async list() {
      const out = [];
      try {
        let res = await rpc("/files/list_folder", { path: "", limit: 2000 });
        for (;;) {
          const page = await res.json();
          for (const e of page.entries ?? []) {
            if (e[".tag"] !== "file" || !NAME_RE.test(e.name)) continue;
            out.push({ id: e.name.slice(0, -5), fileModified: Date.parse(e.server_modified), size: e.size });
          }
          if (!page.has_more) break;
          res = await rpc("/files/list_folder/continue", { cursor: page.cursor });
        }
      } catch (err) {
        throw asRead(err, "list");
      }
      return out;
    },

    async read(id) {
      let text;
      try {
        const res = await call(`${CONTENT}/files/download`, { headers: { "Dropbox-API-Arg": JSON.stringify({ path: path(id) }) } });
        text = await res.text();
      } catch (err) {
        throw asRead(err, "read");
      }
      const sn = parseSnippetFile(text);
      if (sn.id !== id) throw new FolderReadError("id does not match file name");
      return sn;
    },

    async write(sn) {
      const res = await call(`${CONTENT}/files/upload`, {
        headers: {
          "Dropbox-API-Arg": JSON.stringify({ path: path(sn.id), mode: "overwrite", mute: true }),
          "Content-Type": "application/octet-stream",
        },
        body: JSON.stringify({ version: 1, id: sn.id, name: sn.name, content: sn.content, tags: sn.tags, created: sn.created, modified: sn.modified }, null, 2),
      });
      return { fileModified: Date.parse((await res.json()).server_modified) };
    },

    async remove(id) {
      try {
        await rpc("/files/delete_v2", { path: path(id) });
      } catch (err) {
        if (err instanceof DropboxHttpError && err.status === 409 && err.body.includes("not_found")) return;
        throw err;
      }
    },

    async accountName() {
      const a = await (await rpc("/users/get_current_account")).json();
      return a?.name?.display_name || a?.email || "";
    },
  };
}

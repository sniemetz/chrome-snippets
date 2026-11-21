// In-memory Dropbox HTTP API (the endpoints dropbox.js uses) with failure injection.
const NAME_RE = /^\/([0-9a-f-]{36}\.json)$/;
const res = (status, body, headers = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => JSON.parse(text), text: async () => text,
  };
};

export function fakeDropbox({ pageSize = 2000 } = {}) {
  let clockSec = 1_700_000_000;
  let tokenVersion = 1;
  const files = new Map(); // "/<id>.json" -> { text, server_modified }
  const calls = []; // { url, auth, arg, body }
  const failures = []; // queued: status number, { status, headers }, or "network"
  const stamp = () => new Date(++clockSec * 1000).toISOString().replace(".000Z", "Z");
  const meta = (path, f) => ({ ".tag": "file", name: path.slice(1), path_lower: path, server_modified: f.server_modified, size: f.text.length });

  const d = {
    files, calls,
    account: { name: { display_name: "Ada" }, email: "ada@example.com" },
    currentToken: () => `tok${tokenVersion}`,
    expireToken() { tokenVersion++; },
    failNext(status, headers = {}) { failures.push(status === "network" ? "network" : { status, headers }); },
    put(id, text) { files.set(`/${id}.json`, { text, server_modified: stamp() }); },
    async fetch(url, init = {}) {
      const h = init.headers || {};
      const call = { url, auth: h.Authorization, arg: h["Dropbox-API-Arg"] ? JSON.parse(h["Dropbox-API-Arg"]) : null, body: init.body };
      calls.push(call);
      if (call.auth !== `Bearer ${d.currentToken()}`) return res(401, { error_summary: "expired_access_token/" });
      const f = failures.shift();
      if (f === "network") throw new TypeError("Failed to fetch");
      if (f) return res(f.status, { error_summary: "injected" }, f.headers);
      const path = new URL(url).pathname;
      const body = typeof init.body === "string" && h["Content-Type"] !== "application/octet-stream" && init.body ? JSON.parse(init.body) : {};
      if (path === "/2/files/list_folder" || path === "/2/files/list_folder/continue") {
        const all = [...files].map(([p, v]) => meta(p, v));
        const start = path.endsWith("continue") ? Number(body.cursor) : 0;
        const entries = all.slice(start, start + pageSize);
        // a folder entry is always present to prove non-file entries are ignored
        if (start === 0) entries.push({ ".tag": "folder", name: "sub", path_lower: "/sub" });
        const end = start + pageSize;
        return res(200, { entries, cursor: String(end), has_more: end < all.length });
      }
      if (path === "/2/files/upload") {
        const m = NAME_RE.exec(call.arg.path);
        if (!m) return res(409, { error_summary: "path/malformed_path/" });
        const rec = { text: call.body, server_modified: stamp() };
        files.set(call.arg.path, rec);
        return res(200, meta(call.arg.path, rec));
      }
      if (path === "/2/files/download") {
        const rec = files.get(call.arg.path);
        return rec ? res(200, rec.text) : res(409, { error_summary: "path/not_found/" });
      }
      if (path === "/2/files/delete_v2") {
        if (!files.delete(body.path)) return res(409, { error_summary: "path_lookup/not_found/.." });
        return res(200, { metadata: {} });
      }
      if (path === "/2/users/get_current_account") return res(200, d.account);
      return res(404, { error_summary: "unknown endpoint" });
    },
  };
  d.fetch = d.fetch.bind(d);
  return d;
}

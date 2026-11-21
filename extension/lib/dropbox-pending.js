// Pending Dropbox sign-in: the PKCE verifier and the UI mode survive a service-worker restart and a
// closed manager between "open Dropbox" and "paste code". Expires after 15 min.
const KEY = "dropboxPending";
export const PENDING_TTL_MS = 15 * 60_000;
const MODES = ["link", "signin"];

export function createPending({ area, now = Date.now }) {
  const read = async () => (await area.get(KEY))[KEY];
  const valid = (p) => !!p && typeof p.verifier === "string" && p.verifier !== "" && MODES.includes(p.mode)
    && typeof p.createdAt === "number" && now() - p.createdAt >= 0 && now() - p.createdAt <= PENDING_TTL_MS;
  const clear = () => area.remove(KEY);
  return {
    // Overwrites any older entry (expired or malformed ones included).
    async begin(verifier, mode) {
      if (!MODES.includes(mode)) throw new Error("Bad Dropbox sign-in mode");
      await area.set({ [KEY]: { verifier, mode, createdAt: now() } });
    },
    // Non-destructive read: {verifier, mode} or null. A dead entry (expired/malformed) is deleted.
    async get() {
      const p = await read();
      if (valid(p)) return { verifier: p.verifier, mode: p.mode };
      if (p !== undefined) await clear();
      return null;
    },
    clear,
  };
}

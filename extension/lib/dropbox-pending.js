// Pending Dropbox sign-in: the PKCE verifier survives a service-worker restart between "open Dropbox"
// and "paste code". Expires after 15 min; consume() always deletes it.
const KEY = "dropboxPending";
export const PENDING_TTL_MS = 15 * 60_000;

export function createPending({ area, now = Date.now }) {
  return {
    async begin(verifier) { await area.set({ [KEY]: { verifier, createdAt: now() } }); },
    // Returns the verifier or null (missing, malformed or expired); deletes the entry either way.
    async consume() {
      const p = (await area.get(KEY))[KEY];
      await area.remove(KEY);
      if (!p || typeof p.verifier !== "string" || !p.verifier || typeof p.createdAt !== "number") return null;
      const age = now() - p.createdAt;
      return age < 0 || age > PENDING_TTL_MS ? null : p.verifier;
    },
  };
}

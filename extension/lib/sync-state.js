// Persisted sync state under chrome.storage.local key "sync".
const KEY = "sync";

export const INTERVALS = [
  { min: 15, label: "15 min" }, { min: 30, label: "30 min" }, { min: 60, label: "1 h" },
  { min: 120, label: "2 h" }, { min: 360, label: "6 h" }, { min: 720, label: "12 h" },
];

export const defaultState = () => ({
  linked: false, folderName: "", intervalMin: 15, status: "ok", lastSync: null,
  message: "", summary: null, decision: null, synced: {},
  backend: "folder", account: "",
});

export function createSyncState(area = globalThis.chrome?.storage?.local) {
  const read = async () => {
    const s = { ...defaultState(), ...((await area.get(KEY))[KEY] ?? {}) };
    if (!INTERVALS.some((i) => i.min === s.intervalMin)) s.intervalMin = 15;
    return s;
  };
  return {
    get: read,
    async set(patch) {
      const next = { ...(await read()), ...patch };
      await area.set({ [KEY]: next });
      return next;
    },
    clear: () => area.remove(KEY),
  };
}

// True when sync is stopped until the user acts (the toolbar badge shows "!").
export const needsAttention = (st) => st.linked && (st.status === "paused" || st.status === "needs-decision");

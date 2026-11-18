export function memArea() {
  const data = {};
  const gets = [];
  return {
    data, gets,
    async get(keys) {
      gets.push(keys);
      const ks = keys == null ? Object.keys(data) : [].concat(keys);
      const out = {};
      for (const k of ks) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}

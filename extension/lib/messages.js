// Service-worker side of the palette protocol. Pure: takes the store, returns a response.
export async function handleMessage(store, msg) {
  if (!msg || typeof msg !== "object") return undefined;
  if (msg.type === "snippet-search") {
    const query = typeof msg.query === "string" ? msg.query : "";
    return { metas: await store.search({ query }) };
  }
  if (msg.type === "snippet-content" && typeof msg.id === "string") {
    const s = await store.get(msg.id);
    return { content: s ? s.content : null };
  }
  return undefined;
}

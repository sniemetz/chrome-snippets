// Soft size limit: warn, never block.
export const LARGE_SNIPPET_BYTES = 20000;

export function contentBytes(text) {
  return new TextEncoder().encode(text).length;
}

export function largeWarning(content) {
  const bytes = contentBytes(content);
  if (bytes <= LARGE_SNIPPET_BYTES) return null;
  return `This snippet is large (${Math.round(bytes / 1000)} kB). Large snippets slow search, sync and pasting.`;
}

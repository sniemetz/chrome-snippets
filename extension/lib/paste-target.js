// Helpers for pasting into frames the extension may not be allowed to script.

// "https://a.example.com/x" -> "https://a.example.com/*". null for non-http(s) or malformed input.
export function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// True when executeScript was refused for lack of host permission (e.g. a cross-origin iframe).
export function isPermissionError(err) {
  const msg = String(err?.message ?? "");
  return /Cannot access contents|Extension manifest must request permission/i.test(msg);
}

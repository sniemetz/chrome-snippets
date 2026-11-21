// Where to open the manager window: centered on the browser window the user was in.
// (A service worker cannot read the mouse position.) Returns {} to let Chrome place it.
export function centeredPosition(parent, size) {
  const ok = (n) => Number.isFinite(n);
  if (!parent || !ok(parent.left) || !ok(parent.top) || !ok(parent.width) || !ok(parent.height)) return {};
  return {
    left: parent.left + Math.max(0, Math.round((parent.width - size.width) / 2)),
    top: parent.top + Math.max(0, Math.round((parent.height - size.height) / 2)),
  };
}

// Where to open a small window next to `parent` (the manager): right of it, else left of it, else {} (Chrome places it).
// screen: { left, width } of the usable screen area, when known.
export function besidePosition(parent, size, screen) {
  const ok = (n) => Number.isFinite(n);
  if (!parent || !ok(parent.left) || !ok(parent.top) || !ok(parent.width)) return {};
  if (!screen || !ok(screen.left) || !ok(screen.width)) return {};
  const gap = 8, min = screen.left, max = screen.left + screen.width;
  const right = parent.left + parent.width + gap;
  if (right + size.width <= max) return { left: right, top: Math.max(0, parent.top) };
  const left = parent.left - size.width - gap;
  if (left >= min) return { left, top: Math.max(0, parent.top) };
  return {};
}

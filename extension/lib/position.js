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

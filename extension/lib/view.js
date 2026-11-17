// popup.html serves two layouts: the toolbar popup (list only) and the manager window.
export function viewFromSearch(search) {
  return new URLSearchParams(search).get("view") === "window" ? "window" : "toolbar";
}

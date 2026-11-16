import { exportJson, exportFilename, parseFile, mergeAdditive, restoreList, statusLine } from "../lib/importExport.js";

const opts = () => ({ now: Date.now, uuid: () => crypto.randomUUID() });

export function mountDataMenu(root, store, { onStatus }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Data";
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.hidden = true;
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.hidden = true;
  root.append(btn, menu, file);

  let purpose = null; // "import" | "restore"
  const close = () => { menu.hidden = true; };
  const item = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  const showItems = () => {
    menu.replaceChildren(
      item("Export", doExport),
      item("Import", () => pick("import")),
      item("Restore", () => pick("restore")),
    );
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    if (menu.hidden) showItems();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) close(); });

  async function doExport() {
    close();
    const list = await store.list();
    const blob = new Blob([exportJson(list)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = exportFilename(new Date());
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    onStatus(`Exported ${list.length} snippets`);
  }

  function pick(kind) {
    purpose = kind;
    file.value = "";
    file.click();
  }

  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    const parsed = parseFile(await f.text());
    if (!parsed.ok) { close(); onStatus(parsed.error, true); return; }
    if (purpose === "import") {
      close();
      const existing = await store.list();
      const r = mergeAdditive(existing, parsed.snippets, opts());
      await store.replaceAll(r.snippets);
      onStatus(statusLine(r.added, r.skipped));
    } else {
      const current = (await store.list()).length;
      const text = document.createElement("div");
      text.textContent = `Replace ${current} snippets with ${parsed.snippets.length} from file?`;
      const row = document.createElement("div");
      row.append(
        item("Cancel", close),
        item("Replace", async () => {
          close();
          await store.replaceAll(restoreList(parsed.snippets, opts()));
          onStatus(`Restored ${parsed.snippets.length} snippets`);
        }),
      );
      menu.replaceChildren(text, row);
      menu.hidden = false;
    }
  });
}

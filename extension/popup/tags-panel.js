import { StoreError } from "../lib/store.js";
import { tagCounts } from "../lib/tags.js";

// Tag manager: lists every tag with its snippet count; Rename and Delete apply to all snippets.
// Reads and writes metadata only (no snippet content).
export function mountTagsPanel(root, store, { onChanged }) {
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const btn = (label, onclick) => el("button", { type: "button", textContent: label, onclick });
  const plural = (n) => `${n} snippet${n === 1 ? "" : "s"}`;

  async function changed() {
    await onChanged();
    await render();
  }

  function renameRow(li, { tag, count }) {
    const input = el("input", { type: "text", value: tag });
    const err = el("div", { className: "err", hidden: true });
    const save = btn("Save", async () => {
      try {
        await store.renameTag(tag, input.value);
        await changed();
      } catch (e) {
        if (!(e instanceof StoreError)) throw e;
        err.textContent = e.code === "TAG_REQUIRED" ? "Tag name is required" : e.code;
        err.hidden = false;
      }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); if (e.key === "Escape") render(); });
    li.replaceChildren(input, save, btn("Cancel", render), err);
    input.focus();
    input.select();
  }

  function deleteRow(li, { tag, count }) {
    li.replaceChildren(
      el("span", { className: "tname", textContent: `Delete "${tag}" from ${plural(count)}?` }),
      btn("Cancel", render),
      btn("Delete", async () => { await store.deleteTag(tag); await changed(); }),
    );
  }

  async function render() {
    const rows = tagCounts(await store.listMeta());
    root.replaceChildren(el("h2", { textContent: "Tags" }));
    if (!rows.length) {
      root.append(el("p", { className: "placeholder", textContent: "No tags yet. Add tags when editing a snippet." }));
      return;
    }
    const ul = el("ul", { className: "taglist" });
    for (const row of rows) {
      const li = el("li");
      li.append(
        el("span", { className: "tname", textContent: `${row.tag} (${row.count})` }),
        btn("Rename", () => renameRow(li, row)),
        btn("Delete", () => deleteRow(li, row)),
      );
      ul.append(li);
    }
    root.append(ul);
  }

  return { render };
}

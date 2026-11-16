import { createStore, StoreError } from "../lib/store.js";
import { filterSnippets, preview } from "../lib/filter.js";
import { allTags, normalizeTags } from "../lib/tags.js";
import { mountDataMenu } from "./data-menu.js";

const $ = (id) => document.getElementById(id);
const store = createStore(chrome.storage.local);

let snippets = [];
let selectedId = null;
let mode = "none"; // none | edit | new
let addMode = false;
let tags = [];
let baseline = { name: "", content: "", tags: [] };
let debounce;

// ---------- status / confirm ----------
let statusTimer;
function showStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.hidden = true), 4000);
}
function askConfirm(text, noLabel, yesLabel, onYes, onNo) {
  $("confirmText").textContent = text;
  $("confirmNo").textContent = noLabel;
  $("confirmYes").textContent = yesLabel;
  $("footMain").hidden = true;
  $("footConfirm").hidden = false;
  const done = () => {
    $("footConfirm").hidden = true;
    $("footMain").hidden = false;
  };
  $("confirmNo").onclick = () => { done(); onNo?.(); };
  $("confirmYes").onclick = () => { done(); onYes(); };
}

// ---------- list ----------
function renderList() {
  const shown = filterSnippets(snippets, { query: $("search").value, tag: $("tagFilter").value });
  const ul = $("list");
  ul.replaceChildren();
  for (const s of shown) {
    const li = document.createElement("li");
    li.dataset.id = s.id;
    if (s.id === selectedId && mode === "edit") li.classList.add("sel");
    const n = document.createElement("div");
    n.className = "n";
    n.textContent = s.name;
    const p = document.createElement("div");
    p.className = "p";
    p.textContent = preview(s.content);
    li.append(n, p);
    ul.append(li);
  }
}
function renderTagFilter() {
  const sel = $("tagFilter");
  const cur = sel.value;
  const list = allTags(snippets);
  sel.replaceChildren(new Option("All tags", ""), ...list.map((t) => new Option(t, t)));
  sel.value = list.includes(cur) ? cur : "";
  $("tagList").replaceChildren(...list.map((t) => new Option(t)));
}
async function reload() {
  snippets = await store.list();
  renderTagFilter();
  renderList();
}

// ---------- editor ----------
function renderChips() {
  for (const c of document.querySelectorAll(".chip")) c.remove();
  const input = $("tagInput");
  for (const t of tags) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.append(t);
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", `Remove tag ${t}`);
    x.onclick = () => { tags = tags.filter((y) => y !== t); renderChips(); };
    chip.append(x);
    input.before(chip);
  }
}
function commitTagInput() {
  const input = $("tagInput");
  const parts = input.value.split(",");
  input.value = "";
  tags = normalizeTags([...tags, ...parts], allTags(snippets));
  renderChips();
}
function readForm() {
  const pending = $("tagInput").value.split(",");
  return {
    name: $("name").value,
    content: $("content").value,
    tags: normalizeTags([...tags, ...pending], allTags(snippets)),
  };
}
function isDirty() {
  if (mode === "none") return false;
  const f = readForm();
  return f.name !== baseline.name || f.content !== baseline.content ||
    f.tags.join("\u0000") !== baseline.tags.join("\u0000");
}
function setEditor(m, snippet, { content = "" } = {}) {
  mode = m;
  selectedId = snippet?.id ?? null;
  const show = m !== "none";
  $("placeholder").hidden = show;
  $("editor").hidden = !show;
  $("name").value = snippet?.name ?? "";
  $("content").value = snippet?.content ?? content;
  tags = [...(snippet?.tags ?? [])];
  $("tagInput").value = "";
  renderChips();
  for (const id of ["nameErr", "contentErr"]) $(id).hidden = true;
  baseline = { name: $("name").value, content: $("content").value, tags: [...tags] };
  if (m === "new" && content) baseline = { name: "", content: "", tags: [] }; // prefilled content counts as unsaved
  $("saveBtn").disabled = !show;
  $("copyBtn").disabled = !show;
  $("deleteBtn").disabled = m !== "edit";
  $("saveBtn").classList.toggle("primary", show);
  renderList();
}
function guardUnsaved(proceed) {
  if (!isDirty()) return proceed();
  askConfirm("Unsaved changes.", "Keep editing", "Discard", proceed);
}

// ---------- actions ----------
$("list").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li || li.dataset.id === selectedId) return;
  guardUnsaved(() => {
    const s = snippets.find((x) => x.id === li.dataset.id);
    if (s) { endAddMode(); setEditor("edit", s); }
  });
});
$("newBtn").onclick = () => guardUnsaved(() => { endAddMode(); setEditor("new", null); $("name").focus(); });
$("search").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(renderList, 200); });
$("tagFilter").addEventListener("change", renderList);
$("closeBtn").onclick = () => guardUnsaved(() => window.close());

$("tagInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTagInput(); }
  else if (e.key === "Backspace" && !$("tagInput").value && tags.length) { tags.pop(); renderChips(); }
});
$("tagInput").addEventListener("change", commitTagInput);
$("editor").addEventListener("submit", (e) => e.preventDefault());

$("saveBtn").onclick = async () => {
  for (const id of ["nameErr", "contentErr"]) $(id).hidden = true;
  try {
    const f = readForm();
    const saved = mode === "edit" ? await store.update(selectedId, f) : await store.add(f);
    await reload();
    endAddMode();
    setEditor("edit", saved);
    showStatus("Saved");
  } catch (err) {
    if (!(err instanceof StoreError)) throw err;
    const msgs = {
      NAME_REQUIRED: ["nameErr", "Name is required"],
      DUPLICATE_NAME: ["nameErr", "A snippet with this name exists"],
      CONTENT_REQUIRED: ["contentErr", "Content is required"],
      NOT_FOUND: ["nameErr", "Snippet no longer exists"],
    };
    const [id, text] = msgs[err.code] ?? ["nameErr", err.code];
    $(id).textContent = text;
    $(id).hidden = false;
  }
};
$("deleteBtn").onclick = () => {
  askConfirm("Delete this snippet?", "Cancel", "Delete", async () => {
    await store.remove(selectedId);
    await reload();
    endAddMode();
    setEditor("none", null);
  });
};
$("copyBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("content").value);
    showStatus("Copied");
  } catch {
    showStatus("Copy failed", true);
  }
};

// ---------- "Add as snippet" ----------
function endAddMode() {
  addMode = false;
  $("title").textContent = "Snippets";
  $("closeBtn").textContent = "Close";
}
async function applyPendingNew() {
  const { pendingNew } = await chrome.storage.session.get("pendingNew");
  if (!pendingNew) return;
  await chrome.storage.session.remove("pendingNew");
  guardUnsaved(() => {
    addMode = true;
    $("title").textContent = "Add snippet";
    $("closeBtn").textContent = "Cancel";
    setEditor("new", null, { content: pendingNew.content ?? "" });
    $("name").focus();
  });
}
chrome.storage.session.onChanged.addListener((c) => { if (c.pendingNew?.newValue) applyPendingNew(); });
chrome.storage.onChanged.addListener((_c, area) => { if (area === "local") reload(); });

// ---------- boot ----------
mountDataMenu($("dataMount"), store, { onStatus: (t, isErr) => showStatus(t, isErr) });
await reload();
setEditor("none", null);
await applyPendingNew();

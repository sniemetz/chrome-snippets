import { createStore, StoreError } from "../lib/store.js";
import { allTags, normalizeTags } from "../lib/tags.js";
import { formsEqual } from "../lib/dirty.js";
import { largeWarning } from "../lib/limits.js";
import { classifyExternalChange } from "../lib/editor-sync.js";
import { viewFromSearch } from "../lib/view.js";
import { mountDataMenu } from "./data-menu.js";
import { copyWithFeedback, copyTextWithFeedback } from "./copy.js";
import { mountTagsPanel } from "./tags-panel.js";
import { mountSyncPanel } from "./sync-panel.js";
import { createSyncState, needsAttention } from "../lib/sync-state.js";
import { getHandle, putHandle, deleteHandle } from "./handle-store.js";

const $ = (id) => document.getElementById(id);
const view = viewFromSearch(location.search);
document.body.dataset.view = view;
const store = createStore(chrome.storage.local);

let metas = []; // metadata only: content is loaded on select
let queued = null; // 'Add as snippet' text waiting for the editor to be free
let listSeq = 0;
let selectedId = null;
let mode = "none"; // none | edit | new
let addMode = false;
let tags = [];
let baseline = { name: "", content: "", tags: [] };
let loadedMeta = null; // { modified, created } of the snippet as the editor loaded it
let deletedExternally = false;
let selfWriting = false; // true while this page writes, so its own storage events are not "other device" changes
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
function cancelConfirm() {
  $("footConfirm").hidden = true;
}
function askConfirm(text, noLabel, yesLabel, onYes, onNo) {
  $("confirmText").textContent = text;
  $("confirmNo").textContent = noLabel;
  $("confirmYes").textContent = yesLabel;
  $("footConfirm").hidden = false;
  const done = () => { $("footConfirm").hidden = true; };
  $("confirmNo").onclick = () => { done(); onNo?.(); };
  $("confirmYes").onclick = () => { done(); onYes(); };
}

// ---------- list ----------
async function renderList() {
  const mine = ++listSeq;
  const shown = await store.search({ query: $("search").value, tag: $("tagFilter").value });
  if (mine !== listSeq) return;
  const ul = $("list");
  ul.replaceChildren();
  for (const m of shown) {
    const li = document.createElement("li");
    li.dataset.id = m.id;
    const txt = document.createElement("div");
    txt.className = "txt";
    const n = document.createElement("div");
    n.className = "n";
    n.textContent = m.name;
    const p = document.createElement("div");
    p.className = "p";
    p.textContent = m.preview;
    txt.append(n, p);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copybtn";
    copy.textContent = "Copy";
    copy.title = "Copy content to the clipboard";
    li.append(txt, copy);
    ul.append(li);
  }
  markSelected();
}
function markSelected() {
  for (const li of $("list").children) li.classList.toggle("sel", mode === "edit" && li.dataset.id === selectedId);
}
function renderTagFilter() {
  const sel = $("tagFilter");
  const cur = sel.value;
  const list = allTags(metas);
  sel.replaceChildren(new Option("All tags", ""), ...list.map((t) => new Option(t, t)));
  sel.value = list.includes(cur) ? cur : "";
  $("tagList").replaceChildren(...list.map((t) => new Option(t)));
}
async function reload() {
  metas = await store.listMeta();
  renderTagFilter();
  await renderList();
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
  updateSaveState();
}
function commitTagInput() {
  const input = $("tagInput");
  const parts = input.value.split(",");
  input.value = "";
  tags = normalizeTags([...tags, ...parts], allTags(metas));
  renderChips();
}
function readForm() {
  const pending = $("tagInput").value.split(",");
  return {
    name: $("name").value,
    content: $("content").value,
    tags: normalizeTags([...tags, ...pending], allTags(metas)),
  };
}
function isDirty() {
  return mode !== "none" && !formsEqual(readForm(), baseline);
}
function updateSaveState() {
  $("saveBtn").disabled = !isDirty() && !deletedExternally;
}
function showNotice(text) {
  $("editorNotice").textContent = text;
  $("editorNotice").hidden = false;
}
function setEditor(m, snippet, { content = "" } = {}) {
  cancelConfirm();
  $("tagsPanel").hidden = true;
  $("syncPanel").hidden = true;
  $("editorNotice").hidden = true;
  deletedExternally = false;
  loadedMeta = snippet ? { modified: snippet.modified, created: snippet.created } : null;
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
  $("saveBtn").classList.add("primary");
  $("deleteBtn").disabled = m !== "edit";
  updateSaveState();
  markSelected();
}
function guardUnsaved(proceed) {
  if (!isDirty()) return proceed();
  askConfirm("Unsaved changes.", "Keep editing", "Discard", proceed);
}

// ---------- actions ----------
$("list").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const copyBtn = e.target.closest(".copybtn");
  if (copyBtn) { // Copy button = copy (and close the toolbar popup); the rest of the row selects
    copyWithFeedback(store, li.dataset.id, copyBtn, { closeAfter: view === "toolbar" });
    return;
  }
  if (li.dataset.id === selectedId) return;
  guardUnsaved(async () => {
    dropQueued();
    const s = await store.get(li.dataset.id);
    if (!s) { await reload(); return; }
    endAddMode();
    setEditor("edit", s);
  });
});
$("newBtn").onclick = () => guardUnsaved(() => { dropQueued(); endAddMode(); setEditor("new", null); $("name").focus(); });
$("search").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => renderList(), 200); });
$("tagFilter").addEventListener("change", () => renderList());
$("closeBtn").onclick = () => guardUnsaved(() => { queued = null; window.close(); });

$("tagInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTagInput(); }
  else if (e.key === "Backspace" && !$("tagInput").value && tags.length) { tags.pop(); renderChips(); }
});
$("tagInput").addEventListener("change", commitTagInput);
$("editor").addEventListener("submit", (e) => e.preventDefault());
$("copyLink").addEventListener("click", (e) => {
  e.preventDefault();
  const text = $("content").value;
  if (text) copyTextWithFeedback(text, $("copyLink"));
});
for (const id of ["name", "content", "tagInput"]) $(id).addEventListener("input", updateSaveState);

$("saveBtn").onclick = () => doSave(false);

// Re-creates a snippet that another device deleted (same id and created), after the usual checks.
async function recreate(f) {
  const name = f.name.trim();
  if (!name) throw new StoreError("NAME_REQUIRED");
  if (!f.content) throw new StoreError("CONTENT_REQUIRED");
  if (metas.some((m) => m.id !== selectedId && m.name.toLowerCase() === name.toLowerCase())) throw new StoreError("DUPLICATE_NAME");
  const t = Date.now();
  const snippet = { id: selectedId, name, content: f.content, tags: f.tags, created: loadedMeta?.created ?? t, modified: t };
  await store.upsertMany([snippet]);
  return snippet;
}

async function doSave(confirmedLarge) {
  for (const id of ["nameErr", "contentErr"]) $(id).hidden = true;
  selfWriting = true;
  try {
    const f = readForm();
    const warn = confirmedLarge ? null : largeWarning(f.content);
    if (warn) { askConfirm(warn, "Cancel", "Save anyway", () => doSave(true)); return; }
    let saved;
    if (mode === "edit") {
      try {
        saved = await store.update(selectedId, f);
      } catch (err) {
        if (!(err instanceof StoreError && err.code === "NOT_FOUND")) throw err;
        saved = await recreate(f);
      }
    } else {
      saved = await store.add(f);
    }
    await reload();
    showStatus("Saved");
    if (queued !== null) { startAdd(); return; }
    endAddMode();
    setEditor("edit", saved);
  } catch (err) {
    if (!(err instanceof StoreError)) { showStatus(`Save failed: ${err?.message ?? err}`, true); return; }
    const msgs = {
      NAME_REQUIRED: ["nameErr", "Name is required"],
      DUPLICATE_NAME: ["nameErr", "A snippet with this name exists"],
      CONTENT_REQUIRED: ["contentErr", "Content is required"],
      NOT_FOUND: ["nameErr", "Snippet no longer exists"],
    };
    const [id, text] = msgs[err.code] ?? ["nameErr", err.code];
    $(id).textContent = text;
    $(id).hidden = false;
  } finally {
    selfWriting = false;
  }
}
$("deleteBtn").onclick = () => {
  askConfirm("Delete this snippet?", "Cancel", "Delete", async () => {
    selfWriting = true;
    try {
      await store.remove(selectedId);
      await reload();
    } finally {
      selfWriting = false;
    }
    if (queued !== null) { startAdd(); return; }
    endAddMode();
    setEditor("none", null);
  });
};
// ---------- "Add as snippet" ----------
function endAddMode() {
  addMode = false;
  $("title").textContent = "Snippets";
  $("closeBtn").textContent = "Close";
}
function dropQueued() {
  if (queued !== null) showStatus("Selected text discarded", true);
  queued = null;
}
function startAdd() {
  const content = queued ?? "";
  queued = null;
  addMode = true;
  $("title").textContent = "Add snippet";
  $("closeBtn").textContent = "Cancel";
  setEditor("new", null, { content });
  $("name").focus();
}
async function applyPendingNew() {
  const { pendingNew } = await chrome.storage.session.get("pendingNew");
  if (!pendingNew) return;
  await chrome.storage.session.remove("pendingNew");
  queued = pendingNew.content ?? "";
  if (!isDirty()) { startAdd(); return; }
  askConfirm("Unsaved changes. Add selected text?", "Keep editing", "Discard", startAdd,
    () => showStatus("Selected text kept: save or discard to add it"));
}
if (view === "window") {
  chrome.storage.session.onChanged.addListener((c) => { if (c.pendingNew?.newValue) applyPendingNew(); });
}
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  await reload();
  if (!changes.meta || selfWriting || mode !== "edit" || !loadedMeta || deletedExternally) return;
  const current = metas.find((m) => m.id === selectedId);
  const kind = classifyExternalChange(loadedMeta, current, isDirty());
  if (kind === "refresh") {
    const s = await store.get(selectedId);
    if (s) setEditor("edit", s);
  } else if (kind === "notice-changed") {
    loadedMeta = { ...loadedMeta, modified: current.modified };
    showNotice("Changed on another device. Save will overwrite it.");
  } else if (kind === "notice-deleted") {
    deletedExternally = true;
    showNotice("Deleted on another device. Save will re-create it.");
    updateSaveState();
  }
});
let tagsPanel = null;
function showTagsPanel() {
  dropQueued();
  endAddMode();
  setEditor("none", null);
  $("placeholder").hidden = true;
  $("tagsPanel").hidden = false;
  tagsPanel.render();
}
$("tagsBtn").onclick = () => guardUnsaved(showTagsPanel);
let syncPanel = null;
function showSyncPanel() {
  dropQueued();
  endAddMode();
  setEditor("none", null);
  $("placeholder").hidden = true;
  $("syncPanel").hidden = false;
  syncPanel.render();
}
$("syncBtn").onclick = () => guardUnsaved(showSyncPanel);
$("openMgrBtn").onclick = async () => {
  try { await chrome.runtime.sendMessage({ type: "open-manager" }); } catch { /* window opens anyway or not */ }
  window.close();
};

// ---------- toolbar popup: sync gate ----------
// When the badge "!" shows (folder access lost or a decision pending), the popup first shows what the
// user must do; the normal list appears as soon as sync is OK again.
async function mountSyncGate() {
  const gateEl = $("syncGate");
  const leave = () => { document.body.classList.remove("gating"); gateEl.hidden = true; };
  const gate = mountSyncPanel(gateEl, {
    getHandle, putHandle, compact: true, onResolved: leave,
    send: (msg) => chrome.runtime.sendMessage(msg),
    onStatus: (t, isErr) => showStatus(t, isErr),
  });
  if (!needsAttention(await createSyncState(chrome.storage.local).get())) return;
  document.body.classList.add("gating");
  gateEl.hidden = false;
  await gate.render();
}

// ---------- boot ----------
await reload();
setEditor("none", null); // both views edit; the list holds metadata only, content loads per snippet
if (view === "toolbar") await mountSyncGate();
if (view === "window") {
  mountDataMenu($("dataMount"), store, { onStatus: (t, isErr) => showStatus(t, isErr) });
  tagsPanel = mountTagsPanel($("tagsPanel"), store, { onChanged: reload });
  syncPanel = mountSyncPanel($("syncPanel"), {
    getHandle, putHandle, deleteHandle,
    send: (msg) => chrome.runtime.sendMessage(msg),
    onStatus: (t, isErr) => showStatus(t, isErr),
  });
  await applyPendingNew(); // only the window consumes "Add as snippet" text
}

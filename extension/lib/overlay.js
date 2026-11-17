// Injected into pages with scripting.executeScript({ func: openPalette, args: [metas] }).
// MUST stay self-contained: no imports, no references to module scope.
// `metas` = [{ id, name, tags, preview }]. Content is never sent to the page up front:
// searching asks the service worker ("snippet-search"), picking fetches one body ("snippet-content").
export function openPalette(metas, options) {
  // copyOnly: used when the page's frame refused injection; picking copies instead of inserting.
  const copyOnly = !!(options && options.copyOnly);
  const HOST_ID = "__snippet_saver_palette__";
  if (document.getElementById(HOST_ID)) return;

  const NON_TEXT = ["button", "checkbox", "radio", "submit", "file", "color", "range", "image", "reset", "hidden"];
  const isTextField = (el) =>
    !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !NON_TEXT.includes(el.type)));
  const isEditable = (el) => !!el && (isTextField(el) || el.isContentEditable === true);
  const readValue = (el) => (isTextField(el) ? el.value : el.textContent);

  // Save target field, caret and selection before focus moves to the palette.
  let target = document.activeElement;
  while (target && target.shadowRoot && target.shadowRoot.activeElement) target = target.shadowRoot.activeElement;
  let saved = null;
  if (isTextField(target)) {
    saved = { start: target.selectionStart, end: target.selectionEnd };
  } else if (isEditable(target)) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) saved = { range: sel.getRangeAt(0).cloneRange() };
  }

  function toast(text) {
    const h = document.createElement("div");
    h.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;";
    const r = h.attachShadow({ mode: "closed" });
    const st = document.createElement("style");
    st.textContent =
      ".t{font:14px system-ui,sans-serif;background:#1f2328;color:#fff;padding:8px 14px;border-radius:6px;box-shadow:0 2px 10px #0006}";
    const d = document.createElement("div");
    d.className = "t";
    d.textContent = text;
    r.append(st, d);
    document.documentElement.append(h);
    setTimeout(() => h.remove(), 2000);
  }

  async function copyFallback(content) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(content);
      ok = true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = content;
        ta.style.cssText = "position:fixed;opacity:0;";
        document.body.append(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch (e2) {
        ok = false;
      }
    }
    toast(ok ? "Copied. Press Ctrl+V" : "Copy failed");
    // The palette held focus; give it back so Ctrl+V lands in the field (or iframe) the user was in.
    if (target && target.isConnected && target.focus) target.focus();
  }

  function insert(content) {
    let ok = false;
    if (!copyOnly && isEditable(target) && target.isConnected) {
      try {
        target.focus();
        if (saved && saved.range) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(saved.range);
        } else if (saved && isTextField(target) && target.setSelectionRange && saved.start != null) {
          target.setSelectionRange(saved.start, saved.end);
        }
        const before = readValue(target);
        ok = document.execCommand("insertText", false, content);
        if (ok && readValue(target) === before) ok = false;
      } catch (e) {
        ok = false;
      }
    }
    if (!ok) copyFallback(content);
  }

  // ----- UI -----
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    *{box-sizing:border-box}
    .bd{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;
      font:14px system-ui,sans-serif;color:#1f2328}
    .p{width:min(480px,92vw);max-height:min(420px,80vh);background:#fff;border-radius:8px;box-shadow:0 8px 32px #0007;
      display:flex;flex-direction:column;padding:10px;gap:8px}
    input{font:inherit;padding:8px;border:1px solid #d0d7de;border-radius:4px;background:#fff;color:inherit}
    ul{list-style:none;margin:0;padding:0;overflow-y:auto}
    li{padding:6px 8px;border-radius:4px;cursor:pointer}
    li.sel{background:#dbeafe}
    .n{font-weight:600}.pv{font-size:12px;color:#656d76;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .e{padding:8px;color:#656d76}
    @media (prefers-color-scheme:dark){
      .bd{color:#e6edf3}.p{background:#1b1f24}input{background:#23282e;border-color:#3d444d}
      li.sel{background:#1e3a8a}.pv,.e{color:#8b949e}
    }`;
  const bd = document.createElement("div");
  bd.className = "bd";
  const panel = document.createElement("div");
  panel.className = "p";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search snippets";
  const ul = document.createElement("ul");
  panel.append(input, ul);
  bd.append(panel);
  root.append(style, bd);

  let shown = metas;
  let idx = 0;
  let seq = 0;
  function render() {
    if (idx >= shown.length) idx = Math.max(0, shown.length - 1);
    ul.replaceChildren();
    if (!shown.length) {
      const e = document.createElement("li");
      e.className = "e";
      e.textContent = input.value ? "No matches" : "No snippets yet";
      ul.append(e);
      return;
    }
    shown.forEach((m, i) => {
      const li = document.createElement("li");
      if (i === idx) li.className = "sel";
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = m.name;
      const p = document.createElement("div");
      p.className = "pv";
      p.textContent = m.preview;
      li.append(n, p);
      li.addEventListener("click", () => choose(m));
      ul.append(li);
    });
    const sel = ul.querySelector(".sel");
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  }

  let timer = null;
  function search() {
    const mine = ++seq;
    chrome.runtime.sendMessage({ type: "snippet-search", query: input.value }).then(
      (res) => {
        if (mine !== seq || !host.isConnected || !res) return;
        shown = res.metas || [];
        idx = 0;
        render();
      },
      () => {},
    );
  }

  function close() {
    host.remove();
    if (target && target.isConnected && target.focus) target.focus();
  }
  function choose(m) {
    host.remove();
    chrome.runtime.sendMessage({ type: "snippet-content", id: m.id }).then(
      (res) => {
        if (res && typeof res.content === "string") insert(res.content);
        else toast("Snippet not found");
      },
      () => toast("Snippet unavailable"),
    );
  }

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 150); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.max(0, Math.min(idx + 1, shown.length - 1)); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); render(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[idx]) choose(shown[idx]); }
    else if (e.key === "Tab") { e.preventDefault(); }
  });
  bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
  // keep keystrokes away from page hotkeys
  for (const t of ["keydown", "keyup", "keypress"]) host.addEventListener(t, (e) => e.stopPropagation());
  input.addEventListener("blur", () => setTimeout(() => { if (host.isConnected) input.focus(); }, 0));

  document.documentElement.append(host);
  render();
  input.focus();
}

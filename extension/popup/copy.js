// Copy helpers with temporary visible feedback in a label element.
const timers = new WeakMap();

function flash(el, message, ms) {
  if (el.dataset.orig === undefined) el.dataset.orig = el.textContent;
  el.textContent = message;
  clearTimeout(timers.get(el));
  timers.set(
    el,
    setTimeout(() => {
      el.textContent = el.dataset.orig;
      delete el.dataset.orig;
    }, ms),
  );
}

// Copies `text`, shows "Copied!" (or "Copy failed") in labelEl. With closeAfter the window
// closes shortly after a successful write (never before it finished).
export async function copyTextWithFeedback(text, labelEl, { closeAfter = false, flashMs = 1000, closeDelayMs = 600 } = {}) {
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ok = false;
  }
  flash(labelEl, ok ? "Copied!" : "Copy failed", flashMs);
  if (ok && closeAfter) setTimeout(() => window.close(), closeDelayMs);
}

// Reads one snippet's content by id (the only content read) and copies it.
export async function copyWithFeedback(store, id, labelEl, opts = {}) {
  let snippet;
  try {
    snippet = await store.get(id);
  } catch {
    snippet = undefined;
  }
  if (!snippet) {
    flash(labelEl, "Copy failed", opts.flashMs ?? 1000);
    return;
  }
  await copyTextWithFeedback(snippet.content, labelEl, opts);
}

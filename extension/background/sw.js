import { createStore } from "../lib/store.js";
import { openPalette } from "../lib/overlay.js";
import { handleMessage } from "../lib/messages.js";

const store = createStore(chrome.storage.local);
const MANAGER_URL = "popup/popup.html?view=window";
// Outer window size = 600 x 445 content plus window chrome (adjust after manual check).
const WIN = { width: 616, height: 490 };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "paste", title: "Paste snippet", contexts: ["editable"] });
    chrome.contextMenus.create({ id: "add", title: "Add as snippet", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "open", title: "Open Snippets", contexts: ["all"] });
  });
});

async function injectPalette(tabId, frameIds) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      func: openPalette,
      args: [await store.listMeta()],
    });
  } catch (err) {
    // Restricted pages (chrome://, Web Store) refuse injection: nothing to show.
    console.warn("Snippet palette unavailable on this page:", err?.message ?? err);
  }
}

async function openManager() {
  const { windowId } = await chrome.storage.session.get("windowId");
  if (windowId !== undefined) {
    try {
      await chrome.windows.update(windowId, { focused: true });
      return;
    } catch {
      // window is gone; fall through and create a new one
    }
  }
  const win = await chrome.windows.create({ type: "popup", url: MANAGER_URL, ...WIN });
  await chrome.storage.session.set({ windowId: win.id });
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { windowId } = await chrome.storage.session.get("windowId");
  if (windowId === id) await chrome.storage.session.remove("windowId");
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "paste" && tab?.id !== undefined) {
    await injectPalette(tab.id, [info.frameId ?? 0]);
  } else if (info.menuItemId === "add") {
    // Set the selection first: an already-open manager picks it up via storage.onChanged.
    await chrome.storage.session.set({ pendingNew: { content: info.selectionText ?? "" } });
    await openManager();
  } else if (info.menuItemId === "open") {
    await openManager();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-palette") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) await injectPalette(tab.id, [0]);
});

// Palette (injected into pages) asks for search results and for one snippet body at a time.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg && msg.type === "open-manager") {
    openManager().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  handleMessage(store, msg).then(sendResponse, () => sendResponse(undefined));
  return true;
});

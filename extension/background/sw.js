import { createStore } from "../lib/store.js";
import { openPalette } from "../lib/overlay.js";
import { handleMessage } from "../lib/messages.js";
import { originPattern, isPermissionError } from "../lib/paste-target.js";

const store = createStore(chrome.storage.local);
const MANAGER_URL = "popup/popup.html?view=window";
// Outer window size = 600 x 445 content plus window chrome (adjust after manual check).
const WIN = { width: 616, height: 490 };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "paste", title: "Paste snippet", contexts: ["editable"] });
    chrome.contextMenus.create({ id: "allow", title: "Allow Snippets on this site", contexts: ["editable"] });
    chrome.contextMenus.create({ id: "add", title: "Add as snippet", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "open", title: "Open Snippets", contexts: ["all"] });
  });
});

// Short visible feedback on the toolbar icon (no popup is open when a menu item is clicked).
function flashBadge(text, title) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: text === "OK" ? "#166534" : "#b91c1c" });
  if (title) chrome.action.setTitle({ title });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Snippets" });
  }, 3000);
}

// Opens the palette in the clicked frame. A cross-origin frame (e.g. an iframe inside a wrapper
// page) is refused without host permission: fall back to the top page in copy-only mode.
async function injectPalette(tabId, frameId) {
  const metas = await store.listMeta();
  const inject = (id, options) =>
    chrome.scripting.executeScript({ target: { tabId, frameIds: [id] }, func: openPalette, args: [metas, options] });
  try {
    await inject(frameId, {});
    return;
  } catch (err) {
    console.warn("Snippet palette unavailable in this frame:", err?.message ?? err);
    if (frameId === 0 || !isPermissionError(err)) {
      flashBadge("!", "Snippets unavailable on this page");
      return;
    }
  }
  try {
    await inject(0, { copyOnly: true });
  } catch (err) {
    console.warn("Snippet palette unavailable on this page:", err?.message ?? err);
    flashBadge("!", "Snippets unavailable on this page");
  }
}

// Opt-in: ask Chrome for host access to the origin of the clicked frame.
async function allowSite(info) {
  const pattern = originPattern(info.frameUrl || info.pageUrl);
  if (!pattern) {
    flashBadge("!", "Snippets cannot be allowed on this page");
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    flashBadge(granted ? "OK" : "!", granted ? `Snippets allowed on ${pattern}` : "Permission not granted");
  } catch (err) {
    console.warn("Permission request failed:", err?.message ?? err);
    flashBadge("!", "Permission request failed");
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
    await injectPalette(tab.id, info.frameId ?? 0);
  } else if (info.menuItemId === "allow") {
    await allowSite(info);
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
  if (tab?.id !== undefined) await injectPalette(tab.id, 0);
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

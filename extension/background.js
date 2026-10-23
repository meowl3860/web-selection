// The extension's service worker. It loads the brush into a tab and turns it on and off, for
// the panel and for the browser shortcut. It needs no access to pages beyond the tab you
// act on: clicking the button or pressing the shortcut grants that tab for the moment. The
// brush runs in the extension's own world, so the page's scripts and its content security
// policy do not get in the way.

async function run(tabId, func) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return result?.result;
}

/** Whether the brush can run on a tab, and whether it is loaded and on. */
async function state(tabId) {
  try {
    const s = await run(tabId, () => ({ loaded: typeof window.webSelection !== "undefined", enabled: Boolean(window.webSelection?.enabled) }));
    return { available: true, ...s };
  } catch {
    // Browser pages, such as the new tab page and the extension store, do not allow scripts.
    return { available: false, loaded: false, enabled: false };
  }
}

async function toggle(tabId) {
  const s = await state(tabId);
  if (!s.available) return s;
  try {
    if (!s.loaded) await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const enabled = await run(tabId, () => (window.webSelection.toggle(), window.webSelection.enabled));
    return { available: true, loaded: true, enabled };
  } catch (err) {
    console.warn("Web Selection cannot run on this page:", err?.message ?? err);
    return { available: false, loaded: false, enabled: false };
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-brush" && tab?.id) toggle(tab.id);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg?.tabId ?? sender.tab?.id;
  if (msg?.type === "toggle" && tabId) {
    toggle(tabId).then(reply);
    return true;
  }
  if (msg?.type === "state" && tabId) {
    state(tabId).then(reply);
    return true;
  }
  return false;
});

// Loads the selection tools into the current tab on the first click, then turns them on and
// off. The script runs in the extension's own world, so the page's scripts and its content
// security policy do not get in the way.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    const [{ result: loaded }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.webSelection !== "undefined",
    });
    if (!loaded) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["web-selection.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.webSelection.toggle() });
  } catch (err) {
    // Browser pages such as the new tab page and the extension store do not allow scripts.
    console.warn("Web Selection cannot run on this page:", err?.message ?? err);
  }
});

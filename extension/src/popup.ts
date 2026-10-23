// The panel that opens from the toolbar button: start or stop the brush on this page, and see
// the key that turns it on. The key is the browser's own shortcut for the extension, so it
// works on every page without any extra access; Change opens the browser's shortcut settings.

type Tab = { id?: number };
type Command = { name?: string; shortcut?: string };
type ChromeApi = {
  tabs: { query(q: object): Promise<Tab[]>; create(p: { url: string }): Promise<Tab> };
  runtime: { sendMessage(msg: object): Promise<unknown> };
  commands: { getAll(): Promise<Command[]> };
};
declare const chrome: ChromeApi;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $<HTMLButtonElement>("start");
const startLabel = $<HTMLSpanElement>("start-label");
const startKeys = $<HTMLSpanElement>("start-keys");
const keys = $<HTMLDivElement>("keys");
const change = $<HTMLButtonElement>("change");

let tabId: number | undefined;

function kbds(list: string[]): HTMLElement[] {
  return list.map((k) => Object.assign(document.createElement("kbd"), { textContent: k }));
}

function showKey(shortcut: string): void {
  const parts = shortcut ? shortcut.split("+") : [];
  if (parts.length) keys.replaceChildren(...kbds(parts));
  else keys.replaceChildren(Object.assign(document.createElement("span"), { className: "prompt", textContent: "No key set" }));
  startKeys.replaceChildren(...kbds(parts));
}

type State = { available?: boolean; enabled?: boolean };

function showState(s: State): void {
  start.disabled = !s.available;
  startLabel.textContent = !s.available ? "The brush cannot run on this page" : s.enabled ? "Stop the brush" : "Start the brush";
  start.classList.toggle("on", Boolean(s.enabled));
}

start.addEventListener("click", async () => {
  if (tabId === undefined) return;
  await chrome.runtime.sendMessage({ type: "toggle", tabId });
  window.close();
});

change.addEventListener("click", async () => {
  // Edge keeps its settings at edge://, Chrome at chrome://.
  const edge = /\bEdg\//.test(navigator.userAgent);
  await chrome.tabs.create({ url: `${edge ? "edge" : "chrome"}://extensions/shortcuts` });
  window.close();
});

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const commands = await chrome.commands.getAll();
  showKey(commands.find((c) => c.name === "toggle-brush")?.shortcut ?? "");
  showState(tabId === undefined ? {} : ((await chrome.runtime.sendMessage({ type: "state", tabId })) as State));
}

init();

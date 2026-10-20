// The script build for pages and extensions: one shared instance on window.
import { createWebSelection, type WebSelection } from "./controller.js";

declare global {
  interface Window {
    webSelection?: WebSelection;
  }
}

// In an extension's content script, chrome.dom can open closed shadow roots as well.
const dom = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null } } }).chrome?.dom;
const open = dom?.openOrClosedShadowRoot;

window.webSelection ??= createWebSelection(open ? { shadowRoot: (el) => open(el) ?? null } : {});

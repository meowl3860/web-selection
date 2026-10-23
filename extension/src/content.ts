// The extension's content script: one brush per tab, kept on window in the extension's own
// world, so the page's scripts cannot see or reach it.
import { noteBubble } from "../../demo/note-bubble.js";
import { createBrush, type Brush, type ShadowOf } from "../../src/index.js";

declare global {
  interface Window {
    webSelection?: Brush;
  }
}

type ChromeDom = { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null };

// chrome.dom can open closed shadow roots, so pages built from closed web components work too.
// It must be called on chrome.dom itself, and only takes HTML elements: an SVG element throws.
const dom = (globalThis as { chrome?: { dom?: ChromeDom } }).chrome?.dom;
const shadowRoot: ShadowOf | undefined = dom?.openOrClosedShadowRoot
  ? (el) => {
      if (!(el instanceof HTMLElement)) return el.shadowRoot;
      try {
        return dom.openOrClosedShadowRoot!(el) ?? null;
      } catch {
        return el.shadowRoot;
      }
    }
  : undefined;

if (!window.webSelection) {
  window.webSelection = createBrush(shadowRoot ? { shadowRoot } : {});
  // Notes are typed here: speech in a content script would ask each site for the microphone.
  noteBubble(window.webSelection);
}

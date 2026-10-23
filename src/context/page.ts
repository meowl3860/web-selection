// What sits around a selection: the page, the headings above it, and the text just before and
// after it. A model reads a selection better when it knows where on the page it is.

const HEADING = /^h([1-6])$/;
/** How far back to look for headings, in elements, so a huge page stays quick. */
const LOOK_BACK = 20000;

/** The heading level of an element, or 0 when it is not a heading. */
export function headingLevel(el: Element): number {
  const m = HEADING.exec(el.localName);
  if (m) return Number(m[1]);
  if (el.getAttribute("role") === "heading") return Number(el.getAttribute("aria-level")) || 2;
  return 0;
}

/** The headings above an element, from the top level down, such as ["Frame time", "The frame budget"]. */
export function sectionOf(el: Element): string[] {
  const root = el.getRootNode();
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = el;
  const path: string[] = [];
  let below = headingLevel(el) || 7;
  for (let steps = 0; steps < LOOK_BACK && below > 1; steps++) {
    const n = walker.previousNode() as Element | null;
    if (!n) break;
    const level = headingLevel(n);
    if (!level || level >= below) continue;
    const text = oneLine((n as HTMLElement).innerText ?? n.textContent ?? "");
    if (!text) continue;
    path.unshift(text);
    below = level;
  }
  return path;
}

/**
 * Up to `chars` characters of the text before `first` or after `last`, cut at a word, with an
 * ellipsis where it was cut. Text inside any of the selected elements is skipped.
 */
export function textAround(first: Element, last: Element, selected: Element[], chars: number, side: "before" | "after"): string {
  if (chars <= 0) return "";
  const from = side === "before" ? first : last;
  // Inside an article or the main part of a page, its own text is what lies around; menus and
  // side bars beside it are not.
  const region = first.closest("article, main, [role=main]");
  const root = region && region.contains(last) ? region : from.getRootNode();
  const doc = from.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = from;
  const pieces: string[] = [];
  let length = 0;
  let lastBlock: Element | null = null;
  for (let steps = 0; steps < LOOK_BACK && length < chars; steps++) {
    const n = (side === "before" ? walker.previousNode() : walker.nextNode()) as Text | null;
    if (!n) break;
    const parent = n.parentElement;
    if (!parent) continue;
    if (selected.some((s) => s.contains(n)) || (side === "after" && last.contains(n))) continue;
    // Labels inside a drawn chart read as noise out of the picture.
    if (parent.closest("svg")) continue;
    if (typeof parent.checkVisibility === "function" && !parent.checkVisibility({ visibilityProperty: true })) continue;
    const block = blockOf(parent);
    // Code keeps its lines; other text folds its white space, as the browser shows it.
    const text = getComputedStyle(parent).whiteSpace.startsWith("pre") ? n.data.replace(/\n+$/, "") : n.data.replace(/\s+/g, " ");
    if (!/\S/.test(text)) {
      // White space between inline elements keeps words apart.
      if (lastBlock === block && text) pieces[side === "before" ? "unshift" : "push"](" ");
      continue;
    }
    // Cells of one table row stay on one line.
    const cells = lastBlock && /^t[dh]$/.test(block.localName) && /^t[dh]$/.test(lastBlock.localName) && block.parentElement === lastBlock.parentElement;
    const gap = !lastBlock || block === lastBlock ? "" : cells ? " | " : "\n";
    lastBlock = block;
    if (side === "before") pieces.unshift(text + gap);
    else pieces.push(gap + text);
    length += text.length;
  }
  let text = pieces.join("").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (text.length > chars) {
    if (side === "before") {
      text = text.slice(text.length - chars);
      text = "…" + text.slice(Math.max(0, text.search(/\s/) + 1));
    } else {
      text = text.slice(0, chars);
      const cut = text.search(/\s\S*$/);
      text = (cut > 0 ? text.slice(0, cut) : text) + "…";
    }
  }
  return text;
}

function blockOf(el: Element): Element {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const d = getComputedStyle(e).display;
    if (!d.startsWith("inline") && d !== "contents") return e;
  }
  return el;
}

export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

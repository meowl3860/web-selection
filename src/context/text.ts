// The text of one element, as a person reads it, with each character marked as painted or not.
// White space folds the way the browser shows it, except in code and other preformatted text.
// Line breaks and the edges of blocks inside the element become new lines.

/** One character of an element's text, whether paint covers it, and the numbers of the marks that do. */
export interface Char {
  ch: string;
  painted: boolean;
  marks?: number[];
}

/** The text of a list of text nodes, with the characters inside `ranges` marked as painted. */
export function textOf(nodes: Text[], ranges: Range[]): Char[] {
  const out: Char[] = [];
  let prev: Text | null = null;
  for (const node of nodes) {
    if (prev && breaksBetween(prev, node)) push(out, "\n", false, true);
    prev = node;
    const keep = keepsSpace(node);
    const spans = ranges.map((r) => spanIn(r, node)).filter((s): s is [number, number] => s !== null);
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]!;
      const painted = spans.some(([s, e]) => i >= s && i < e);
      if (keep) out.push({ ch: ch === "\r" ? "" : ch, painted });
      else if (/\s/.test(ch)) push(out, " ", painted, false);
      else out.push({ ch, painted });
    }
  }
  return tidy(out);
}

/** Adds folding white space: one space at most, none at the start of a line. */
function push(out: Char[], ch: " " | "\n", painted: boolean, hard: boolean): void {
  const last = out[out.length - 1];
  if (hard) {
    while (out.length && out[out.length - 1]!.ch === " ") out.pop();
    if (out.length && out[out.length - 1]!.ch !== "\n") out.push({ ch: "\n", painted: false });
    return;
  }
  if (!last || last.ch === " " || last.ch === "\n") return;
  out.push({ ch, painted });
}

/** Takes white space off both ends. */
function tidy(chars: Char[]): Char[] {
  let s = 0, e = chars.length;
  while (s < e && /\s/.test(chars[s]!.ch)) s++;
  while (e > s && /\s/.test(chars[e - 1]!.ch)) e--;
  return chars.slice(s, e).filter((c) => c.ch !== "");
}

/** The part of a text node inside a range, as offsets; null when they do not meet. */
function spanIn(r: Range, node: Text): [number, number] | null {
  try {
    if (!r.intersectsNode(node)) return null;
    const s = r.startContainer === node ? r.startOffset : r.comparePoint(node, 0) >= 0 ? 0 : node.length;
    const e = r.endContainer === node ? r.endOffset : r.comparePoint(node, node.length) <= 0 ? node.length : 0;
    return e > s ? [s, e] : null;
  } catch {
    // The range lies in another tree, such as a different shadow root.
    return null;
  }
}

function keepsSpace(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  const ws = getComputedStyle(parent).whiteSpace;
  return ws.startsWith("pre") || ws === "break-spaces";
}

const BLOCK_DISPLAY = /^(block|flex|grid|table|list-item|flow-root)/;

/** True when a line break, or the edge of a block, lies between two text nodes. */
function breaksBetween(a: Text, b: Text): boolean {
  if (a.getRootNode() !== b.getRootNode()) return true;
  const root = a.getRootNode();
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = a;
  for (let steps = 0; steps < 200; steps++) {
    const n = walker.nextNode();
    if (!n || n === b) return false;
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as Element;
    if (el.localName === "br") return true;
    if (BLOCK_DISPLAY.test(getComputedStyle(el).display)) return true;
  }
  return true;
}

/** The text as a string. */
export function plain(chars: Char[]): string {
  return chars.map((c) => c.ch).join("");
}

/** True when some, but not nearly all, of the text is painted. */
export function partlyPainted(chars: Char[]): boolean {
  let painted = 0, all = 0;
  for (const c of chars) {
    if (/\s/.test(c.ch)) continue;
    all++;
    if (c.painted) painted++;
  }
  return painted > 0 && painted < all * 0.9;
}

/** The text with each painted run between an opening and a closing mark. */
export function marked(chars: Char[], open: string, close: string): string {
  return tagged(chars, (c) => (c.painted ? open : null), close);
}

/**
 * The text with each run of characters that share an opening tag between that tag and the
 * closing one; `tagOf` gives the tag of a character, or null for none.
 */
export function tagged(chars: Char[], tagOf: (c: Char) => string | null, close: string): string {
  let out = "";
  let on: string | null = null;
  for (const c of chars) {
    const tag = tagOf(c);
    // Marks stay inside a line, so they never wrap a line break of code or of a list.
    if (on !== null && (tag !== on || c.ch === "\n")) {
      out += close;
      on = null;
    }
    if (on === null && tag !== null && c.ch !== "\n" && !/\s/.test(c.ch)) {
      out += tag;
      on = tag;
    }
    out += c.ch;
  }
  if (on !== null) out += close;
  return out.replace(new RegExp(`(\\s+)${escape(close)}`, "g"), `${close}$1`);
}

/** Only the runs that `inRun` keeps, by default the painted ones, in order. */
export function paintedRuns(chars: Char[], inRun: (c: Char) => boolean = (c) => c.painted): string[] {
  const runs: string[] = [];
  let cur = "";
  for (const c of chars) {
    if (inRun(c)) cur += c.ch;
    else if (cur) {
      runs.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) runs.push(cur.trim());
  return runs.filter(Boolean);
}

/**
 * Shortens the text that is not painted, keeping `keep` characters on each side of every
 * painted run and an ellipsis where text was left out. With nothing painted, keeps the start.
 */
export function shorten(chars: Char[], keep: number): Char[] {
  if (!chars.some((c) => c.painted)) return chars.length > keep * 2 ? [...chars.slice(0, keep * 2), { ch: "…", painted: false }] : chars;
  const near = new Array<boolean>(chars.length).fill(false);
  for (let i = 0; i < chars.length; i++) {
    if (!chars[i]!.painted) continue;
    for (let j = Math.max(0, i - keep); j <= Math.min(chars.length - 1, i + keep); j++) near[j] = true;
  }
  // Each kept piece starts and ends on a whole word.
  const space = (i: number) => i < 0 || i >= chars.length || /\s/.test(chars[i]!.ch);
  for (let i = 0; i < chars.length; i++) {
    if (!near[i] || near[i - 1]) continue;
    let j = i;
    while (near[j] && !chars[j]!.painted && !space(j - 1)) near[j++] = false;
  }
  for (let i = chars.length - 1; i >= 0; i--) {
    if (!near[i] || near[i + 1]) continue;
    let j = i;
    while (near[j] && !chars[j]!.painted && !space(j + 1)) near[j--] = false;
  }
  const out: Char[] = [];
  let gap = false;
  for (let i = 0; i < chars.length; i++) {
    if (near[i]) {
      if (gap) out.push({ ch: " … ", painted: false });
      gap = false;
      out.push(chars[i]!);
    } else gap = true;
  }
  if (gap) out.push({ ch: " …", painted: false });
  return out;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Turns a selection into context an AI model can read: the selected parts of the page as
// Markdown or JSON, with the painted words marked, where on the page they are, a little of the
// text around them, and pictures with the user's paint on them. It takes the brush's items,
// plain elements or DOM ranges, so it works with any way of selecting.
//
// When the user marked more than one place, or wrote a note, each mark is numbered: in the text,
// on the pictures, and in the list of notes at the end. The page comes first and the notes
// last, since the notes are what the user asks for.

import type { ItemMark, PaintArea, SelectedItem } from "../brush.js";
import { flatParent, openShadow, type ShadowOf } from "../dom.js";
import { isCode } from "../look.js";
import { HIDDEN_TAGS, kindOf, type TargetKind } from "../targets.js";
import { headingLevel, oneLine, sectionOf, textAround } from "./page.js";
import { boxText, cropBox, pictureName, pixelsOf, render, visibleBox, type PixelHook, type Pixels, type Rendered } from "./picture.js";
import { marked, paintedRuns, partlyPainted, plain, shorten, tagged, textOf, type Char } from "./text.js";
import { estimateTokens, imageTokens } from "./tokens.js";

export { estimateTokens, imageTokens } from "./tokens.js";
export type { PixelHook, PixelSource } from "./picture.js";

/** What to select from: the brush's items, elements, or ranges such as the page's own text selection. */
export type ContextInput = SelectedItem | Element | Range;

/**
 * How text shows what the user painted:
 * - "marked": whole elements, with the painted words between <mark> and </mark>.
 * - "whole": whole elements, with no marks.
 * - "painted": only the painted words.
 */
export type TextMode = "marked" | "whole" | "painted";

/**
 * Which pictures go with the text:
 * - "full": the picture, a copy with the paint drawn on it, and the painted box as numbers.
 * - "balanced": the copy with the paint, smaller, and the box as numbers.
 * - "budget": a crop of the painted part, and the box as numbers.
 * - "none": no pictures; their names and the box as numbers.
 */
export type ImageMode = "full" | "balanced" | "budget" | "none";

/** Each kind of picture to send, for a mix the modes do not have. */
export interface ImageParts {
  /** The picture as it shows on the page. */
  original?: boolean;
  /** A copy with the user's paint drawn on it. */
  marked?: boolean;
  /** The painted part, with some room around it. */
  crop?: boolean;
  /** Where the paint is, as a share of the picture's width and height. */
  box?: boolean;
  /** The longest side of a picture sent, in pixels. */
  size?: number;
}

export interface ContextOptions {
  text?: TextMode;
  images?: ImageMode | ImageParts;
  /** How many characters of the text just before and just after the selection to add. */
  around?: number;
  /** The most tokens the context may take; it is cut down to fit. */
  budget?: number;
  format?: "markdown" | "json";
  /** Your own way to get a picture's pixels, for pictures the page may not read, such as ones from other sites. */
  pixels?: PixelHook;
  /** The colour of the paint drawn on pictures. */
  color?: string;
  /** How to reach shadow roots when collecting the text of elements. */
  shadowRoot?: ShadowOf;
}

export type ContextPart =
  | { type: "text"; text: string }
  | { type: "image"; label: string; mediaType: "image/png" | "image/jpeg"; data: string; width: number; height: number };

export interface AIContext {
  /** Text and pictures in order, ready to map onto a model API's message content. */
  parts: ContextPart[];
  /** The text parts joined, with a line naming each picture where it goes. */
  text: string;
  /** About how many input tokens the parts take, for Claude models. */
  tokens: number;
}

// Picked by the test series in tests/eval: marked text and full pictures answered best.
const DEFAULTS = { text: "marked" as TextMode, images: "full" as ImageMode, around: 300, format: "markdown" as const };

const IMAGE_MODES: Record<ImageMode, Required<ImageParts>> = {
  full: { original: true, marked: true, crop: false, box: true, size: 1568 },
  balanced: { original: false, marked: true, crop: false, box: true, size: 768 },
  budget: { original: false, marked: false, crop: true, box: true, size: 512 },
  none: { original: false, marked: false, crop: false, box: true, size: 0 },
};
const DOWNGRADE: ImageMode[] = ["full", "balanced", "budget", "none"];
/** A crop is drawn at least this many pixels on its longer side. */
const CROP_SHOWN = 256;
/** A mix of parts starts from nothing, at the full size. */
const MIX: Required<ImageParts> = { original: false, marked: false, crop: false, box: false, size: 1568 };

/** Turns a selection into context for an AI model. */
export async function toContext(input: Iterable<ContextInput>, options: ContextOptions = {}): Promise<AIContext> {
  const items = normalize([...input], options.shadowRoot ?? openShadow);
  const prep = await prepare(items, options);
  let o: Settings = {
    text: options.text ?? DEFAULTS.text,
    images: typeof options.images === "object" ? { ...MIX, ...options.images } : IMAGE_MODES[options.images ?? DEFAULTS.images],
    around: options.around ?? DEFAULTS.around,
    keep: Infinity,
    format: options.format ?? DEFAULTS.format,
  };
  let ctx = compose(prep, o);
  const budget = options.budget;
  if (!budget) return ctx;
  // Over budget: less text around, then smaller pictures, then less of the text that is not painted.
  const mode = typeof options.images === "string" ? options.images : options.images ? null : DEFAULTS.images;
  const steps: ((s: Settings) => Settings | null)[] = [
    (s) => (s.around > 100 ? { ...s, around: 100 } : null),
    (s) => (s.around > 0 ? { ...s, around: 0 } : null),
    ...DOWNGRADE.slice(mode ? DOWNGRADE.indexOf(mode) + 1 : 1).map((m) => (s: Settings) => ({ ...s, images: IMAGE_MODES[m] })),
    ...[300, 120, 40, 0].map((keep) => (s: Settings) => (s.keep > keep ? { ...s, keep } : null)),
  ];
  for (const step of steps) {
    if (ctx.tokens <= budget) break;
    const next = step(o);
    if (!next) continue;
    o = next;
    ctx = compose(prep, o);
  }
  return ctx.tokens <= budget ? ctx : cut(ctx, budget);
}

/* ---------- the selection, made plain ---------- */

interface Item {
  el: Element;
  kind: TargetKind;
  nodes: Text[];
  ranges: Range[];
  area: PaintArea | null;
  marks: ItemMark[];
}

/** True when every stroke of paint on an element is a short dab rather than a line. */
function touched(area: PaintArea): boolean {
  const paint = area.strokes.filter((s) => !s.erase);
  return paint.length > 0 && paint.every((s) => {
    const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) <= s.radius * 2;
  });
}

function isItem(x: ContextInput): x is SelectedItem {
  return typeof x === "object" && x !== null && "element" in x && "area" in x;
}

function isRange(x: ContextInput): x is Range {
  return typeof x === "object" && x !== null && "startContainer" in x && "commonAncestorContainer" in x;
}

function normalize(input: ContextInput[], shadowOf: ShadowOf): Item[] {
  const byEl = new Map<Element, Item>();
  const whole: Element[] = [];
  for (const x of input) {
    if (isItem(x)) {
      // A touch is a tap on the element: the word under the dab is not what it points at.
      const marks = (x.marks ?? []).map((m) => (touched(m.area) ? { ...m, ranges: [] } : m));
      byEl.set(x.element, { el: x.element, kind: x.kind, nodes: x.textNodes, ranges: touched(x.area) ? [] : x.ranges, area: x.area, marks });
    } else if (isRange(x)) {
      if (x.collapsed) continue;
      for (const [block, nodes] of blocksIn(x)) {
        const have = byEl.get(block);
        if (have) have.ranges.push(x);
        else byEl.set(block, { el: block, kind: "text", nodes, ranges: [x], area: null, marks: [] });
      }
    } else if (x.nodeType === Node.ELEMENT_NODE) {
      whole.push(x);
      byEl.set(x, { el: x, kind: kindOf(x), nodes: textNodesIn(x, shadowOf), ranges: [], area: null, marks: [] });
    }
  }
  // An element given whole owns only the text outside the other given elements inside it.
  for (const el of whole) {
    const inner = [...byEl.keys()].filter((o) => o !== el && el.contains(o));
    if (inner.length) byEl.get(el)!.nodes = byEl.get(el)!.nodes.filter((n) => !inner.some((o) => o.contains(n)));
  }
  return [...byEl.values()].sort((a, b) => order(a.el, b.el));
}

function order(a: Element, b: Element): number {
  if (a.getRootNode() !== b.getRootNode()) return 0;
  const p = a.compareDocumentPosition(b);
  return p & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : p & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
}

/** The text nodes a person sees inside an element, in reading order, through shadow roots and slots. */
function textNodesIn(el: Element, shadowOf: ShadowOf): Text[] {
  const out: Text[] = [];
  const stack: Node[] = [el];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.nodeType === Node.TEXT_NODE) {
      if (/\S/.test((n as Text).data)) out.push(n as Text);
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const e = n as Element;
    if (HIDDEN_TAGS.has(e.localName)) continue;
    if (e !== el && typeof e.checkVisibility === "function" && !e.checkVisibility({ visibilityProperty: true }) && getComputedStyle(e).display !== "contents") continue;
    const kids = e.localName === "slot" ? (e as HTMLSlotElement).assignedNodes({ flatten: true }) : [...(shadowOf(e)?.childNodes ?? e.childNodes)];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}

/** The blocks a range runs through, each with all its text nodes. */
function blocksIn(r: Range): Map<Element, Text[]> {
  const out = new Map<Element, Text[]>();
  const top = r.commonAncestorContainer;
  const rootEl = top.nodeType === Node.ELEMENT_NODE ? (top as Element) : top.parentElement;
  if (!rootEl) return out;
  const hit: Text[] = [];
  if (top.nodeType === Node.TEXT_NODE) hit.push(top as Text);
  else {
    const walker = rootEl.ownerDocument.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (r.intersectsNode(n) && /\S/.test((n as Text).data)) hit.push(n as Text);
  }
  for (const n of hit) {
    const block = blockAround(n);
    if (block && !out.has(block)) out.set(block, textNodesIn(block, openShadow));
  }
  return out;
}

function blockAround(n: Node): Element | null {
  for (let e = flatParent(n); e; e = flatParent(e)) {
    const d = getComputedStyle(e).display;
    if (d !== "contents" && !d.startsWith("inline") && !d.startsWith("ruby")) return e;
  }
  return null;
}

/* ---------- blocks ---------- */

type Role =
  | { kind: "heading"; level: number }
  | { kind: "list"; bullet: string; depth: number }
  | { kind: "code"; lang: string }
  | { kind: "quote" }
  | { kind: "caption" }
  | { kind: "term" }
  | { kind: "paragraph" };

type Block =
  | { type: "text"; role: Role; chars: Char[]; marks: number[] }
  | { type: "table"; table: HTMLTableElement; cells: Map<Element, Char[]> }
  | { type: "picture"; n: number; item: Item; name: string; caption: string; pixels: Pixels | null }
  | { type: "control"; text: string };

interface Prepared {
  title: string;
  url: string;
  section: string[];
  blocks: Block[];
  items: Item[];
  color: string;
  renders: Map<string, Rendered | null>;
  /** The marks with their notes, by number, when they are numbered; empty when they are not. */
  notes: { n: number; note: string }[];
}

interface Settings {
  text: TextMode;
  images: Required<ImageParts>;
  around: number;
  /** How much unpainted text to keep around painted words; Infinity keeps all of it. */
  keep: number;
  format: "markdown" | "json";
}

async function prepare(items: Item[], options: ContextOptions): Promise<Prepared> {
  const all = new Map<number, string>();
  for (const it of items) for (const m of it.marks) all.set(m.n, m.note);
  // One mark with no note reads best as it always did: no numbers.
  const numbered = all.size > 1 || [...all.values()].some(Boolean);
  if (!numbered) for (const it of items) it.marks = [];
  const blocks: Block[] = [];
  const tables = new Map<HTMLTableElement, Map<Element, Char[]>>();
  let pictures = 0;
  for (const it of items) {
    if (it.kind === "media") {
      const size = it.area ?? { width: it.el.getBoundingClientRect().width, height: it.el.getBoundingClientRect().height };
      const pixels = await pixelsOf(it.el, size, options.pixels);
      const name = pictureName(it.el);
      const fig = it.el.closest("figure")?.querySelector("figcaption")?.textContent;
      const caption = fig ? oneLine(fig) : "";
      blocks.push({ type: "picture", n: ++pictures, item: it, name, caption: caption === name ? "" : caption, pixels });
      continue;
    }
    if (it.kind === "control") {
      blocks.push({ type: "control", text: controlText(it.el) });
      continue;
    }
    const chars = textOf(it.nodes, it.ranges);
    if (!chars.length) continue;
    // Each character learns which marks paint it. The texts line up, since only the ranges differ.
    for (const m of it.marks) {
      if (!m.ranges.length) continue;
      textOf(it.nodes, m.ranges).forEach((c, i) => {
        if (c.painted && chars[i]) (chars[i]!.marks ??= []).push(m.n);
      });
    }
    const cell = it.el.closest("td, th");
    const table = cell?.closest("table") as HTMLTableElement | null;
    if (cell && table) {
      let cells = tables.get(table);
      if (!cells) {
        tables.set(table, (cells = new Map()));
        blocks.push({ type: "table", table, cells });
      }
      // A cell whose paint covers no single word is still the one the user pointed at.
      const numbers = it.marks.map((m) => m.n);
      cells.set(cell, chars.some((c) => c.painted) ? chars : chars.map((c) => ({ ...c, painted: true, ...(numbers.length ? { marks: numbers } : {}) })));
      continue;
    }
    blocks.push({ type: "text", role: roleOf(it.el), chars, marks: it.marks.map((m) => m.n) });
  }
  const doc = items[0]?.el.ownerDocument ?? document;
  return {
    title: oneLine(doc.title),
    url: doc.URL,
    section: items[0] ? sectionOf(items[0].el) : [],
    blocks,
    items,
    color: options.color ?? "#4b57f0",
    renders: new Map(),
    notes: [...all].sort((a, b) => a[0] - b[0]).map(([n, note]) => ({ n, note })).filter(() => numbered),
  };
}

function roleOf(el: Element): Role {
  const level = headingLevel(el);
  if (level) return { kind: "heading", level };
  const tag = el.localName;
  if (tag === "li") {
    const list = el.parentElement;
    let depth = 0;
    for (let e = list?.parentElement; e; e = e.parentElement) if (e.localName === "ul" || e.localName === "ol") depth++;
    if (list?.localName === "ol") {
      const start = Number(list.getAttribute("start")) || 1;
      const index = [...list.children].filter((c) => c.localName === "li").indexOf(el);
      return { kind: "list", bullet: `${start + Math.max(0, index)}.`, depth };
    }
    return { kind: "list", bullet: "-", depth };
  }
  if (isCode(el)) {
    const cls = `${el.className} ${el.querySelector("code")?.className ?? ""}`;
    return { kind: "code", lang: /(?:language|lang)-([\w+#-]+)/.exec(cls)?.[1] ?? "" };
  }
  if (tag === "figcaption" || tag === "caption") return { kind: "caption" };
  if (tag === "dt") return { kind: "term" };
  if (el.closest("blockquote")) return { kind: "quote" };
  return { kind: "paragraph" };
}

function controlText(el: Element): string {
  const c = el as HTMLInputElement;
  if (el.localName === "button" || c.type === "button" || c.type === "submit") return `[button: ${oneLine(el.textContent || c.value || el.getAttribute("aria-label") || "")}]`;
  const label = el.getAttribute("aria-label") || (el.id && el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || c.placeholder || "";
  // A field can hold a whole document, as a code editor does; a little of it says what it is.
  const value = oneLine(c.value ?? "");
  return `[field${label ? ` "${oneLine(label)}"` : ""}: ${value.length > 300 ? value.slice(0, 300) + "…" : value}]`;
}

/* ---------- writing it out ---------- */

const OPEN = "<mark>";
const CLOSE = "</mark>";

/**
 * The text of a block's characters, as the mode asks, and the marks that cover the block as a
 * whole rather than word by word, which go in front of it as "[Mark n]".
 */
function textFor(chars: Char[], s: Settings, blockMarks: number[] = []): { text: string; marks: boolean; whole: number[] } {
  chars = gathered(chars);
  const kept = Number.isFinite(s.keep) ? shorten(chars, s.keep) : chars;
  const partial = partlyPainted(chars);
  const inWords = partial ? [...new Set(chars.flatMap((c) => c.marks ?? []))].sort((a, b) => a - b) : [];
  const whole = blockMarks.filter((n) => !inWords.includes(n));
  if (!blockMarks.length) {
    if (s.text === "painted" && partial) return { text: paintedRuns(chars).join(" … "), marks: false, whole };
    if (s.text === "marked" && partial) return { text: marked(kept, OPEN, CLOSE), marks: true, whole };
    return { text: plain(kept), marks: false, whole };
  }
  if (s.text === "painted" && partial) {
    const runs = inWords.map((n) => `[Mark ${n}] ${paintedRuns(chars, (c) => c.marks?.includes(n) ?? false).join(" … ")}`);
    return { text: runs.join("\n"), marks: false, whole };
  }
  if (s.text === "marked" && partial) return { text: tagged(kept, (c) => (c.marks?.length ? `<mark id="${c.marks.join(",")}">` : null), CLOSE), marks: true, whole };
  return { text: plain(kept), marks: false, whole: blockMarks };
}

/** Painted words in this many places or more in one block mean a stroke went through it. */
const SCATTERED = 3;

/**
 * A stroke that goes down through a paragraph paints a word here and there on each line it
 * crosses; those words mean the paragraph, not themselves. Such paint is taken as covering the
 * whole block: the marks on single words go, for each mark on its own.
 */
function gathered(chars: Char[]): Char[] {
  const runs = (inRun: (c: Char) => boolean) => paintedRuns(chars, inRun).length;
  const marks = [...new Set(chars.flatMap((c) => c.marks ?? []))];
  const through = new Set(marks.filter((n) => runs((c) => c.marks?.includes(n) ?? false) >= SCATTERED));
  const all = runs((c) => c.painted) >= SCATTERED && (!marks.length || through.size === marks.length);
  if (!all && !through.size) return chars;
  return chars.map((c) => {
    const left = c.marks?.filter((n) => !through.has(n));
    return { ch: c.ch, painted: all ? false : c.painted && Boolean(left?.length), ...(left?.length ? { marks: left } : {}) };
  });
}

/** "[Mark 1]" or "[Marks 1, 2]" for marks that cover a whole block. */
function markLabel(numbers: number[]): string {
  return numbers.length ? `[Mark${numbers.length > 1 ? "s" : ""} ${numbers.join(", ")}]` : "";
}

function compose(p: Prepared, s: Settings): AIContext {
  const items = p.items;
  const first = items[0]?.el, last = items[items.length - 1]?.el;
  // A selected picture's caption is already given with the picture.
  const els = items.flatMap((i) => (i.kind === "media" ? [i.el, i.el.closest("figure") ?? i.el] : [i.el]));
  const before = first && last ? textAround(first, last, els, s.around, "before") : "";
  const after = first && last ? textAround(first, last, els, s.around, "after") : "";
  const out = new Parts();
  let anyMarks = false;
  const pictures: { block: Extract<Block, { type: "picture" }>; images: { label: string; r: Rendered }[]; box: string | null }[] = [];
  for (const b of p.blocks) {
    if (b.type !== "picture") continue;
    pictures.push({ block: b, ...pictureParts(p, b, s.images) });
  }

  if (s.format === "json") {
    const selection: unknown[] = [];
    for (const b of p.blocks) {
      if (b.type === "text") {
        const t = textFor(b.chars, s, b.marks);
        anyMarks ||= t.marks;
        selection.push({ type: b.role.kind, ...(b.role.kind === "heading" ? { level: b.role.level } : {}), ...(b.role.kind === "code" && b.role.lang ? { lang: b.role.lang } : {}), ...(b.marks.length ? { marks: b.marks } : {}), text: t.text });
      } else if (b.type === "table") {
        const t = tableJson(b, s);
        anyMarks ||= t.marks;
        selection.push(t.json);
      } else if (b.type === "control") selection.push({ type: "control", text: b.text });
      else {
        const pic = pictures.find((x) => x.block === b)!;
        const numbers = b.item.marks.map((m) => m.n);
        selection.push({ type: "picture", picture: b.n, name: b.name, ...(numbers.length ? { marks: numbers } : {}), ...(b.caption ? { caption: b.caption } : {}), ...(pic.box ? { paintedArea: pic.box } : {}), ...(pic.images.length ? { images: pic.images.map((i) => i.label) } : {}), ...(b.pixels ? {} : { note: "pixels not readable" }) });
      }
    }
    const doc = {
      note: preface(s, anyMarks, pictures.length > 0, p.notes.length),
      page: { title: p.title, url: p.url },
      ...(p.section.length ? { section: p.section } : {}),
      ...(before ? { before } : {}),
      selection,
      ...(after ? { after } : {}),
      ...(p.notes.length ? { notes: p.notes.map((x) => ({ mark: x.n, note: x.note })) } : {}),
    };
    out.text(JSON.stringify(doc, null, 1));
    for (const pic of pictures) for (const img of pic.images) out.image(img.label, img.r);
    return out.done();
  }

  const body: string[] = [];
  const flush = () => {
    if (body.length) out.text(body.join("\n\n"));
    body.length = 0;
  };
  for (const b of p.blocks) {
    if (b.type === "text") {
      const t = textFor(b.chars, s, b.marks);
      anyMarks ||= t.marks;
      const label = markLabel(t.whole);
      body.push((label ? label + "\n" : "") + blockMarkdown(b.role, t.text));
    } else if (b.type === "table") {
      const t = tableMarkdown(b, s);
      anyMarks ||= t.marks;
      body.push(t.text);
    } else if (b.type === "control") body.push(b.text);
    else {
      const pic = pictures.find((x) => x.block === b)!;
      const numbers = b.item.marks.map((m) => m.n);
      const facts = [`Picture ${b.n}${b.name ? `: "${b.name}"` : ""}${numbers.length ? ` ${markLabel(numbers)}` : ""}`];
      if (b.caption) facts.push(`caption "${b.caption}"`);
      if (pic.box) facts.push(`painted area ${pic.box}`);
      if (!b.pixels) facts.push("its pixels could not be read");
      body.push(`[${facts.join("; ")}]`);
      if (pic.images.length) {
        flush();
        for (const img of pic.images) out.image(img.label, img.r);
      }
    }
  }
  const head = [preface(s, anyMarks, pictures.length > 0, p.notes.length), `Page: ${p.title}`, `URL: ${p.url}`];
  if (p.section.length) head.push(`Section: ${p.section.join(" > ")}`);
  const top = head.join("\n") + (before ? `\n\n<before>\n${before}\n</before>` : "") + "\n\n<selection>";
  out.prepend(top);
  flush();
  out.text("</selection>" + (after ? `\n\n<after>\n${after}\n</after>` : ""));
  if (p.notes.length) out.text(["The user's notes, by mark:", ...p.notes.map((x) => `${x.n}. ${x.note || "(no note)"}`)].join("\n"));
  return out.done();
}

function preface(s: Settings, marks: boolean, pictures: boolean, numbered: number): string {
  if (numbered) {
    let t = `The user marked ${numbered} place${numbered > 1 ? "s" : ""} on a web page by painting over ${numbered > 1 ? "them, numbered from 1" : "it"}, and wrote notes, which come last.`;
    if (s.text === "painted") t += " Only the painted words of the text are given, after the number of their mark.";
    else if (marks) t += ' <mark id="n"> holds the words of mark n.';
    t += " [Mark n] before a part means mark n covers it as a whole.";
    if (pictures && s.images.marked) t += " On pictures, the paint is drawn on a copy, with the number of each mark.";
    else if (pictures && s.images.crop) t += " For pictures, each mark's part is cut out.";
    return t;
  }
  let t = "The user painted over part of a web page to point at it.";
  if (s.text === "painted") t += " Only the painted words of the text are given.";
  else if (marks) t += " The painted words are between <mark> and </mark>.";
  if (pictures && s.images.marked) t += " On pictures, the paint is drawn on a copy.";
  else if (pictures && s.images.crop) t += " For pictures, the painted part is cut out.";
  return t;
}

function blockMarkdown(role: Role, text: string): string {
  switch (role.kind) {
    case "heading":
      return `${"#".repeat(role.level)} ${oneLine(text)}`;
    case "list":
      return `${"  ".repeat(role.depth)}${role.bullet} ${text.replace(/\n/g, "\n" + "  ".repeat(role.depth + 1))}`;
    case "code":
      return "```" + role.lang + "\n" + text + "\n```";
    case "quote":
      return text.split("\n").map((l) => `> ${l}`).join("\n");
    case "caption":
      return `*${oneLine(text)}*`;
    case "term":
      return `**${oneLine(text)}**`;
    default:
      return text;
  }
}

/** The header row of a table, and the rows that hold selected cells, with those cells marked. */
function tableRows(b: Extract<Block, { type: "table" }>, s: Settings): { caption: string; header: string[] | null; rows: string[][]; marks: boolean } {
  const cellText = (c: Element) => oneLine((c as HTMLElement).innerText ?? c.textContent ?? "").replace(/\|/g, "\\|");
  const rows = [...b.table.rows];
  const headRow = b.table.tHead?.rows[0] ?? (rows[0] && [...rows[0].cells].every((c) => c.localName === "th") ? rows[0] : null);
  const picked = rows.filter((r) => r !== headRow && [...r.cells].some((c) => b.cells.has(c)));
  let marks = false;
  const out = picked.map((r) =>
    [...r.cells].map((c) => {
      const chars = b.cells.get(c);
      if (!chars) return cellText(c);
      if (s.text === "whole") return plain(chars);
      marks = true;
      const numbered = chars.some((c) => c.marks?.length);
      return (numbered ? tagged(chars, (c) => (c.marks?.length ? `<mark id="${c.marks.join(",")}">` : null), CLOSE) : marked(chars, OPEN, CLOSE)).replace(/\|/g, "\\|");
    }),
  );
  return { caption: b.table.caption ? oneLine(b.table.caption.textContent ?? "") : "", header: headRow ? [...headRow.cells].map(cellText) : null, rows: out, marks };
}

function tableMarkdown(b: Extract<Block, { type: "table" }>, s: Settings): { text: string; marks: boolean } {
  if (s.text === "painted") return { text: [...b.cells.values()].map((c) => paintedRuns(c).join(" … ") || plain(c)).join("\n"), marks: false };
  const t = tableRows(b, s);
  const width = Math.max(t.header?.length ?? 0, ...t.rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${[...cells, ...new Array(Math.max(0, width - cells.length)).fill("")].join(" | ")} |`;
  const lines = [];
  if (t.caption) lines.push(`Table: ${t.caption}`);
  lines.push(line(t.header ?? new Array(width).fill("")), line(new Array(width).fill("---")));
  for (const r of t.rows) lines.push(line(r));
  return { text: lines.join("\n"), marks: t.marks };
}

function tableJson(b: Extract<Block, { type: "table" }>, s: Settings): { json: object; marks: boolean } {
  if (s.text === "painted") return { json: { type: "table", cells: [...b.cells.values()].map((c) => paintedRuns(c).join(" … ") || plain(c)) }, marks: false };
  const t = tableRows(b, s);
  return { json: { type: "table", ...(t.caption ? { caption: t.caption } : {}), ...(t.header ? { header: t.header } : {}), rows: t.rows }, marks: t.marks };
}

/** The pictures to send for one picture block, and its painted box as text. */
function pictureParts(p: Prepared, b: Extract<Block, { type: "picture" }>, want: Required<ImageParts>): { images: { label: string; r: Rendered }[]; box: string | null } {
  const area = b.item.area;
  const px = b.pixels;
  const size = area ?? { width: px?.frame.w ?? 0, height: px?.frame.h ?? 0 };
  const visible = px ? visibleBox(px, size) : { x: 0, y: 0, w: size.width, h: size.height };
  const marks = b.item.marks;
  const box = !want.box || !area ? null : marks.length ? marks.map((m) => `mark ${m.n} ${boxText(m.area, visible) ?? "(none)"}`).join("; ") : boxText(area, visible);
  const images: { label: string; r: Rendered }[] = [];
  if (!px || !want.size) return { images, box };
  const get = (key: string, make: () => Rendered | null) => {
    if (!p.renders.has(key)) p.renders.set(key, make());
    return p.renders.get(key) ?? null;
  };
  const painted = Boolean(area?.box);
  // Without paint on it there is nothing to mark or crop, so the picture goes as it is.
  const original = want.original || (!painted && (want.marked || want.crop));
  if (original) {
    const r = get(`${b.n}:o:${want.size}`, () => render(px, visible, want.size, null));
    if (r) images.push({ label: `Picture ${b.n}:`, r });
  }
  if (want.marked && painted) {
    // The paint of all marks together, so erasing applies in the order it was done; then numbers.
    const numbers = marks.filter((m) => m.area.box).map((m) => ({ n: m.n, x: m.area.box!.x0 * m.area.width, y: m.area.box!.y0 * m.area.height }));
    const r = get(`${b.n}:m:${want.size}`, () => render(px, visible, want.size, { strokes: area!.strokes, color: p.color, numbers }));
    if (r) images.push({ label: `Picture ${b.n} with the user's paint on it${numbers.length ? ", numbered by mark" : ""}:`, r });
  }
  if (want.crop && painted) {
    // With numbered marks, each mark gets its own crop.
    const parts = marks.length ? marks.map((m) => ({ a: m.area, label: `Picture ${b.n}, the part of mark ${m.n}:`, key: `c${m.n}` })) : [{ a: area!, label: `Picture ${b.n}, the painted part:`, key: "c" }];
    for (const part of parts) {
      const c = cropBox(part.a, visible);
      const r = c ? get(`${b.n}:${part.key}:${want.size}`, () => render(px, c, want.size, null, CROP_SHOWN)) : null;
      if (r) images.push({ label: part.label, r });
    }
  }
  return { images, box };
}

/** Builds the parts in order, joining text that sits next to text. */
class Parts {
  private readonly list: ContextPart[] = [];

  text(t: string): void {
    const last = this.list[this.list.length - 1];
    if (last?.type === "text") last.text += "\n\n" + t;
    else this.list.push({ type: "text", text: t });
  }

  prepend(t: string): void {
    const first = this.list[0];
    if (first?.type === "text") first.text = t + "\n\n" + first.text;
    else this.list.unshift({ type: "text", text: t });
  }

  image(label: string, r: Rendered): void {
    this.text(label);
    this.list.push({ type: "image", label, ...r });
  }

  done(): AIContext {
    return finish(this.list);
  }
}

function finish(parts: ContextPart[]): AIContext {
  let tokens = 0;
  const text: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      tokens += estimateTokens(part.text);
      text.push(part.text);
    } else {
      tokens += imageTokens(part.width, part.height);
      text.push(`[image ${part.width}×${part.height}]`);
    }
  }
  return { parts, text: text.join("\n"), tokens };
}

/** The last resort for a budget: cut the text at the end, and drop pictures that do not fit. */
function cut(ctx: AIContext, budget: number): AIContext {
  const parts: ContextPart[] = [];
  let left = budget;
  for (const part of ctx.parts) {
    if (part.type === "image") {
      const t = imageTokens(part.width, part.height);
      if (t <= left) {
        parts.push(part);
        left -= t;
      }
      continue;
    }
    const t = estimateTokens(part.text);
    if (t <= left) {
      parts.push(part);
      left -= t;
      continue;
    }
    if (left > 8) parts.push({ type: "text", text: part.text.slice(0, Math.floor((part.text.length * left) / t) - 1) + "…" });
    left = 0;
  }
  return finish(parts);
}

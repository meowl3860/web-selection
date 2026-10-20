// What a block looks like, and how far apart two looks are. This is the magic wand's idea of
// colour: Photoshop compares pixel colours against a tolerance, and here the wand compares
// kind, type size, weight, font, colour, background and indent.

import { flatParent } from "./dom.js";
import type { Block, BlockKind } from "./page.js";

export type RGBA = readonly [r: number, g: number, b: number, a: number];

export interface Features {
  kind: BlockKind;
  tag: string;
  /** Heading level 1 to 6, or 0. */
  level: number;
  fontSize: number;
  fontWeight: number;
  family: string;
  italic: boolean;
  mono: boolean;
  color: RGBA;
  background: RGBA;
  /** Left edge in page coordinates. */
  left: number;
  width: number;
  lineHeight: number;
  /** Keeps spaces and line breaks as written, as in code. */
  pre: boolean;
  /** The list that holds a list item, or 0. */
  list: number;
  /** How many lists hold the block. */
  depth: number;
  /** The table that holds a cell, or 0, and the cell's column. */
  table: number;
  column: number;
  /** For pictures: the tag and the area in square pixels. */
  media: string;
  area: number;
}

const MONO = /mono|courier|consol|menlo|monaco|code|fira code|source code|jetbrains/i;

export function readFeatures(block: Block, idOf: (el: Element) => number): Features {
  const el = block.el;
  const view = el.ownerDocument.defaultView!;
  const cs = view.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const tag = el.localName;

  // The text style is read where most of the text sits, so a list item made of one link
  // compares by the link's colour, not the item's.
  let styleEl: Element = el;
  let longest = -1;
  for (const a of block.atoms) {
    if (a.type !== "text") continue;
    const len = a.node.data.trim().length;
    const parent = flatParent(a.node);
    if (len > longest && parent) {
      longest = len;
      styleEl = parent;
    }
  }
  const ts = styleEl === el ? cs : view.getComputedStyle(styleEl);
  const fontSize = parseFloat(ts.fontSize) || 16;
  const family = firstFamily(ts.fontFamily);
  const mono = MONO.test(ts.fontFamily) || ["code", "pre", "kbd", "samp", "tt"].includes(styleEl.localName);
  const pre = /^pre/.test(cs.whiteSpace) || cs.whiteSpaceCollapse === "preserve";
  const lh = parseFloat(ts.lineHeight);

  let depth = 0;
  let quoted = false;
  for (let e = flatParent(el); e; e = flatParent(e)) {
    if (e.localName === "ul" || e.localName === "ol") depth++;
    else if (e.localName === "blockquote") quoted = true;
  }

  const level = headingLevel(el);
  let kind: BlockKind;
  if (block.kind === "media") kind = "media";
  else if (level) kind = "heading";
  else if (tag === "pre" || (mono && pre)) kind = "code";
  else if (tag === "td" || tag === "th" || cs.display === "table-cell") kind = "cell";
  else if (tag === "figcaption" || tag === "caption" || cs.display === "table-caption") kind = "caption";
  else if (tag === "dt" || tag === "dd") kind = "term";
  else if (tag === "li" || (cs.display === "list-item" && tag !== "summary")) kind = "list-item";
  else if (quoted || tag === "blockquote") kind = "quote";
  else if (tag === "p") kind = "paragraph";
  else kind = "text";

  let table: Element | null = null;
  if (kind === "cell") for (let e = flatParent(el); e && !table; e = flatParent(e)) if (e.localName === "table") table = e;
  const list = kind === "list-item" ? flatParent(el) : null;

  return {
    kind,
    tag,
    level,
    fontSize,
    fontWeight: parseInt(ts.fontWeight, 10) || 400,
    family,
    italic: ts.fontStyle !== "normal",
    mono,
    color: parseColor(ts.color),
    background: backgroundOf(el),
    left: rect.left + view.scrollX,
    width: rect.width,
    lineHeight: Number.isFinite(lh) ? lh : fontSize * 1.2,
    pre,
    list: list ? idOf(list) : 0,
    depth,
    table: table ? idOf(table) : 0,
    column: kind === "cell" ? ((el as HTMLTableCellElement).cellIndex ?? 0) : 0,
    media: kind === "media" ? el.localName : "",
    area: kind === "media" ? Math.max(1, rect.width * rect.height) : 0,
  };
}

/** Blocks with the same signature look the same to the wand. */
export function signature(f: Features): string {
  return [
    f.kind, f.tag, f.level, Math.round(f.fontSize * 2), f.fontWeight, f.family, +f.italic, +f.mono,
    f.color.join(","), f.background.join(","), Math.round(f.left), f.list, f.depth, f.table, f.column,
    f.media, f.area ? Math.round(Math.log2(f.area) * 2) : 0,
  ].join("|");
}

const KIND_GAP: Record<string, number> = {
  "paragraph|text": 6,
  "list-item|paragraph": 18,
  "list-item|text": 18,
  "paragraph|quote": 16,
  "quote|text": 16,
  "paragraph|term": 16,
  "term|text": 16,
  "list-item|term": 16,
  "caption|paragraph": 22,
  "caption|text": 22,
  "cell|paragraph": 26,
  "cell|text": 26,
};

function kindGap(a: BlockKind, b: BlockKind): number {
  if (a === b) return 0;
  if (a === "media" || b === "media") return 100;
  if (a === "heading" || b === "heading" || a === "code" || b === "code") return 40;
  return KIND_GAP[a < b ? `${a}|${b}` : `${b}|${a}`] ?? 30;
}

/**
 * How different two blocks look, from 0 for the same look upward. The wand takes a block when
 * this is at or under its tolerance. As a guide: about 20 keeps to one kind of block, about 40
 * takes most body text, and 100 takes everything.
 */
export function distance(a: Features, b: Features): number {
  let d = kindGap(a.kind, b.kind);
  if (d >= 100) return d;
  if (a.kind === b.kind && a.tag !== b.tag) d += 5;
  if (a.kind === "heading" && b.kind === "heading") d += Math.min(30, 10 * Math.abs(a.level - b.level));
  d += Math.min(40, Math.abs(Math.log2(a.fontSize / b.fontSize)) * 55);
  d += Math.min(18, (Math.abs(a.fontWeight - b.fontWeight) / 100) * 6);
  if (a.family !== b.family) d += 12;
  if (a.italic !== b.italic) d += 8;
  d += colorDistance(a.color, b.color) * 30;
  // A tinted box is an edge on the page even when the tint is faint, like a callout.
  const bg = colorDistance(a.background, b.background);
  if (bg > 0.01) d += 16 + bg * 30;
  d += Math.min(12, Math.abs(a.left - b.left) / 4);
  if (a.kind === "list-item" && b.kind === "list-item") {
    if (a.list !== b.list) d += 4;
    d += Math.min(12, 6 * Math.abs(a.depth - b.depth));
  }
  if (a.kind === "cell" && b.kind === "cell") {
    if (a.table !== b.table) d += 16;
    else if (a.column !== b.column) d += 12;
  }
  if (a.kind === "media" && b.kind === "media") {
    if (a.media !== b.media) d += 20;
    d += Math.min(30, Math.abs(Math.log2(a.area / b.area)) * 8);
  }
  return d;
}

/** 0 for the same colour, 1 for black against white. Transparent colours fade toward 0. */
export function colorDistance(a: RGBA, b: RGBA): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  const d = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  return Math.min(1, d / 764.8) * Math.max(0.25, Math.min(a[3], b[3]));
}

export function parseColor(s: string): RGBA {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(s);
  if (!m) return [0, 0, 0, 1];
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a /= 100;
  return [Math.round(+m[1]!), Math.round(+m[2]!), Math.round(+m[3]!), a];
}

function backgroundOf(el: Element): RGBA {
  const view = el.ownerDocument.defaultView!;
  for (let e: Element | null = el; e; e = flatParent(e)) {
    const c = parseColor(view.getComputedStyle(e).backgroundColor);
    if (c[3] > 0.05) return [c[0], c[1], c[2], 1];
  }
  return [255, 255, 255, 1];
}

function firstFamily(list: string): string {
  return (list.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
}

function headingLevel(el: Element): number {
  const m = /^h([1-6])$/.exec(el.localName);
  if (m) return +m[1]!;
  if (el.getAttribute("role") === "heading") return Math.min(6, Math.max(1, parseInt(el.getAttribute("aria-level") ?? "2", 10) || 2));
  return 0;
}

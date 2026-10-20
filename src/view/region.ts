// Turns a selection into the shapes the overlay draws. A whole simple block is drawn as its
// box. Part of a block is drawn as solid line bands, the way text selection looks. Blocks that
// follow each other in the selection are joined across the gap between them, so a run of
// paragraphs reads as one area with one outline, as it would in Photoshop.

import { fromDOMRect, intersectRect, outline, type Loop, type Rect } from "../core/geometry.js";
import { flatParent } from "../core/dom.js";
import { size, type IntervalSet } from "../core/intervals.js";
import type { Block, PageIndex, Piece } from "../core/page.js";

const BOX_PAD = 3;
const LINE_PAD = 2;

function grow(r: Rect, dx: number, dy: number): Rect {
  return { x0: r.x0 - dx, y0: r.y0 - dy, x1: r.x1 + dx, y1: r.y1 + dy };
}

export interface Region {
  loops: Loop[];
  /** True when some of it sits in a fixed or sticky box, which moves when the page scrolls. */
  pinned: boolean;
}

export class Measure {
  private readonly clips = new Map<Element, Rect | null>();
  private readonly pins = new Map<Element, boolean>();
  readonly range: Range;

  constructor(
    readonly doc: Document,
    readonly origin: { x: number; y: number },
    readonly dpr: number,
  ) {
    this.range = doc.createRange();
  }

  local(r: DOMRectReadOnly): Rect {
    return fromDOMRect(r, -this.origin.x, -this.origin.y);
  }

  /** The part of the page an element can show through its scroll boxes; null if none. */
  clipOf(el: Element): Rect | null {
    const have = this.clips.get(el);
    if (have !== undefined) return have;
    const parent = flatParent(el);
    let clip: Rect | null = { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 };
    if (parent && parent !== this.doc.body && parent !== this.doc.documentElement) {
      clip = this.clipOf(parent);
      if (clip) {
        const cs = getComputedStyle(parent);
        const cx = cs.overflowX !== "visible";
        const cy = cs.overflowY !== "visible";
        if (cx || cy) {
          const r = parent.getBoundingClientRect();
          const x0 = r.left + parent.clientLeft - this.origin.x;
          const y0 = r.top + parent.clientTop - this.origin.y;
          const box = {
            x0: cx ? x0 : -1e7,
            y0: cy ? y0 : -1e7,
            x1: cx ? x0 + parent.clientWidth : 1e7,
            y1: cy ? y0 + parent.clientHeight : 1e7,
          };
          clip = intersectRect(clip, box);
        }
      }
    }
    this.clips.set(el, clip);
    return clip;
  }

  pinned(el: Element): boolean {
    const have = this.pins.get(el);
    if (have !== undefined) return have;
    const pos = getComputedStyle(el).position;
    const up = flatParent(el);
    const v = pos === "fixed" || pos === "sticky" || (up ? this.pinned(up) : false);
    this.pins.set(el, v);
    return v;
  }

  snap(v: number): number {
    return Math.round(v * this.dpr) / this.dpr;
  }
}

/** The outline loops of a selection. */
export function regionOf(index: PageIndex, set: IntervalSet, m: Measure): Region {
  if (!set.length) return { loops: [], pinned: false };
  const rects: Rect[] = [];
  let pinned = false;
  let prev: { rects: Rect[]; lh: number; endsAt: number } | null = null;
  for (const entry of byBlock(index, set)) {
    const { block, pieces } = entry;
    const clip = m.clipOf(block.el);
    if (!clip) {
      prev = null;
      continue;
    }
    if (m.pinned(block.el)) pinned = true;
    const lh = block.features.lineHeight;
    const whole = size(block.span) === pieces.reduce((n, p) => n + p.to - p.from, 0);
    // A little room around the text, so the outline never touches the letters.
    let own: Rect[];
    if (block.kind === "media" || (whole && block.leaf)) {
      const r = block.el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const box = m.local(r);
        box.x0 -= markerRoom(block.el);
        own = [grow(box, BOX_PAD, BOX_PAD)];
      } else own = [];
    } else own = solidify(lineRects(pieces, m), lh).map((r) => grow(r, LINE_PAD, 0));
    own = own.map((r) => intersectRect(r, clip)).filter((r): r is Rect => !!r);
    if (!own.length) continue;
    const startsAt = pieces[0]!.atom.start + pieces[0]!.from;
    // Join to the block before when the selection runs on without a break between them.
    if (prev && sameRun(set, prev.endsAt, startsAt)) rects.push(...bridges(prev.rects, own, Math.max(prev.lh, lh)));
    rects.push(...own);
    const last = pieces[pieces.length - 1]!;
    prev = { rects: own, lh, endsAt: last.atom.start + last.to };
  }
  const snapped = rects.map((r) => ({ x0: m.snap(r.x0), y0: m.snap(r.y0), x1: m.snap(r.x1), y1: m.snap(r.y1) }));
  return { loops: outline(snapped), pinned };
}

/**
 * A list item's number or bullet sits outside its box, in the list's left padding. A whole
 * item takes that room too, so the outline goes around the marker, not through it.
 */
function markerRoom(el: Element): number {
  const cs = getComputedStyle(el);
  if (cs.display !== "list-item" || cs.listStylePosition !== "outside") return 0;
  if (cs.listStyleType === "none" && cs.listStyleImage === "none") return 0;
  const list = el.parentElement;
  if (!list) return 0;
  const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
  const offset = el.getBoundingClientRect().left - (list.getBoundingClientRect().left + list.clientLeft + pad);
  return Math.max(0, Math.min(pad + Math.max(0, offset), (parseFloat(cs.fontSize) || 16) * 2.5));
}

function* byBlock(index: PageIndex, set: IntervalSet): Generator<{ block: Block; pieces: Piece[] }> {
  // Pieces arrive in reading order of atoms; a block's atoms can be split by a nested block,
  // so gather by block and yield in block order.
  const map = new Map<Block, Piece[]>();
  for (const p of index.pieces(set)) {
    const list = map.get(p.atom.block);
    if (list) list.push(p);
    else map.set(p.atom.block, [p]);
  }
  const entries = [...map].sort((a, b) => a[0].order - b[0].order);
  for (const [block, pieces] of entries) yield { block, pieces };
}

function sameRun(set: IntervalSet, a: number, b: number): boolean {
  for (const [s, e] of set) if (a > s && a <= e) return b >= s && b < e;
  return false;
}

function lineRects(pieces: Piece[], m: Measure): Rect[] {
  const out: Rect[] = [];
  const r = m.range;
  for (const p of pieces) {
    const a = p.atom;
    if (a.type === "text") {
      r.setStart(a.node, p.from);
      r.setEnd(a.node, p.to);
      for (const b of r.getClientRects()) if (b.width > 0 && b.height > 0) out.push(m.local(b));
    } else if (a.type === "media") {
      const b = a.el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) out.push(m.local(b));
    }
  }
  return out;
}

/**
 * Line boxes into solid bands: each line grows to the full line height, pieces on one line
 * become one band, and the small gaps between lines close.
 */
export function solidify(rects: Rect[], lineHeight: number): Rect[] {
  if (!rects.length) return [];
  const grown = rects.map((r) => {
    const h = r.y1 - r.y0;
    if (h >= lineHeight) return { ...r };
    const pad = (lineHeight - h) / 2;
    return { x0: r.x0, y0: r.y0 - pad, x1: r.x1, y1: r.y1 + pad };
  });
  grown.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  // Group into lines by vertical overlap.
  const lines: Rect[][] = [];
  for (const r of grown) {
    const line = lines[lines.length - 1];
    if (line) {
      const top = Math.min(...line.map((q) => q.y0));
      const bottom = Math.max(...line.map((q) => q.y1));
      const overlap = Math.min(bottom, r.y1) - Math.max(top, r.y0);
      if (overlap >= Math.min(bottom - top, r.y1 - r.y0) * 0.5) {
        line.push(r);
        continue;
      }
    }
    lines.push([r]);
  }
  const bands: Rect[][] = lines.map((line) => {
    const y0 = Math.min(...line.map((q) => q.y0));
    const y1 = Math.max(...line.map((q) => q.y1));
    const xs = line.map((q) => [q.x0, q.x1] as const).sort((a, b) => a[0] - b[0]);
    const spans: [number, number][] = [];
    const join = Math.max(4, lineHeight * 0.5);
    for (const [x0, x1] of xs) {
      const last = spans[spans.length - 1];
      if (last && x0 - last[1] <= join) last[1] = Math.max(last[1], x1);
      else spans.push([x0, x1]);
    }
    return spans.map(([x0, x1]) => ({ x0, y0, x1, y1 }));
  });
  for (let i = 0; i + 1 < bands.length; i++) {
    const a = bands[i]!;
    const b = bands[i + 1]!;
    const gap = b[0]!.y0 - a[0]!.y1;
    if (gap > 0 && gap <= lineHeight * 0.75) for (const r of a) r.y1 = b[0]!.y0;
  }
  return bands.flat();
}

/** Rectangles that fill the gap between the bottom of one block and the top of the next. */
function bridges(upper: Rect[], lower: Rect[], lineHeight: number): Rect[] {
  const bottom = Math.max(...upper.map((r) => r.y1));
  const top = Math.min(...lower.map((r) => r.y0));
  const gap = top - bottom;
  const most = Math.min(72, Math.max(24, lineHeight * 2.5));
  if (gap <= 0 || gap > most) return [];
  const a = upper.filter((r) => r.y1 >= bottom - 1);
  const b = lower.filter((r) => r.y0 <= top + 1);
  const out: Rect[] = [];
  for (const p of a) {
    for (const q of b) {
      const x0 = Math.max(p.x0, q.x0);
      const x1 = Math.min(p.x1, q.x1);
      if (x1 > x0) out.push({ x0, y0: bottom, x1, y1: top });
    }
  }
  return out;
}

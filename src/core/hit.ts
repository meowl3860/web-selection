// Hit tests in local coordinates: page coordinates measured from the overlay's origin, so a
// shape drawn before a scroll still lines up with the text after it.

import {
  center, circleTouchesRect, fromDOMRect, insidePolygon, insideRect, polygonBounds, rectsTouch,
  type Point, type Rect,
} from "./geometry.js";
import { deepElementAt, type ShadowOf } from "./dom.js";
import { normalize, type Interval, type IntervalSet } from "./intervals.js";
import type { Atom, Block, PageIndex, TextAtom } from "./page.js";

export type Origin = () => { x: number; y: number };

/** A shape for the marquee, the lasso, or a brush stroke: round dabs along a path. */
export type Shape =
  | { type: "rect"; rect: Rect }
  | { type: "polygon"; points: readonly Point[] }
  | { type: "stroke"; points: readonly Point[]; radius: number };

function shapeBounds(s: Shape): Rect | null {
  if (s.type === "rect") return s.rect;
  const b = polygonBounds(s.points);
  if (!b || s.type === "polygon") return b;
  return { x0: b.x0 - s.radius, y0: b.y0 - s.radius, x1: b.x1 + s.radius, y1: b.y1 + s.radius };
}

function inside(s: Shape, p: Point): boolean {
  if (s.type === "rect") return insideRect(p, s.rect);
  if (s.type === "polygon") return insidePolygon(p, s.points);
  const r2 = s.radius * s.radius;
  return s.points.some(([x, y]) => (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2);
}

/**
 * Character boxes, measured once per gesture. The layout does not change while the user
 * drags, so the boxes stay right and each drag frame only tests points.
 */
export class Hits {
  private readonly lineRects = new Map<Atom, Rect[]>();
  private readonly charCenters = new Map<TextAtom, Float64Array>();
  private readonly blockRects = new Map<Block, Rect[]>();
  private readonly range: Range;

  // Boxes are kept in local coordinates, which do not change when the page scrolls. Each
  // measurement reads the origin at the same moment as the box, so a scroll mid-drag is safe.
  constructor(
    private readonly index: PageIndex,
    private readonly origin: Origin,
  ) {
    this.range = (index.atoms[0]?.block.el.ownerDocument ?? document).createRange();
  }

  private local(r: DOMRectReadOnly): Rect {
    const o = this.origin();
    return fromDOMRect(r, -o.x, -o.y);
  }

  /** The line boxes of a whole atom. */
  atomRects(atom: Atom): Rect[] {
    let list = this.lineRects.get(atom);
    if (list) return list;
    list = [];
    if (atom.type === "text") {
      this.range.selectNodeContents(atom.node);
      for (const r of this.range.getClientRects()) if (r.width > 0 && r.height > 0) list.push(this.local(r));
    } else if (atom.type === "media") {
      const r = atom.el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) list.push(this.local(r));
    }
    this.lineRects.set(atom, list);
    return list;
  }

  /** Centre points of each character, as x, y pairs. NaN marks a character with no box. */
  private centers(atom: TextAtom): Float64Array {
    let c = this.charCenters.get(atom);
    if (c) return c;
    const n = atom.end - atom.start;
    c = new Float64Array(n * 2);
    const r = this.range;
    const o = this.origin();
    for (let i = 0; i < n; i++) {
      r.setStart(atom.node, i);
      r.setEnd(atom.node, i + 1);
      const b = r.getBoundingClientRect();
      if (b.width > 0 || b.height > 0) {
        c[i * 2] = b.left + b.width / 2 - o.x;
        c[i * 2 + 1] = b.top + b.height / 2 - o.y;
      } else {
        c[i * 2] = NaN;
        c[i * 2 + 1] = NaN;
      }
    }
    this.charCenters.set(atom, c);
    return c;
  }

  /**
   * The characters and pictures inside a shape. Spaces and characters with no box join a run
   * when they sit between two characters inside it, so a run does not break at each space.
   */
  inShape(shape: Shape): IntervalSet {
    const bounds = shapeBounds(shape);
    if (!bounds) return [];
    const out: Interval[] = [];
    let runStart = -1;
    let runEnd = -1;
    const flush = () => {
      if (runStart >= 0) out.push([runStart, runEnd]);
      runStart = -1;
    };
    for (const atom of this.index.atoms) {
      if (atom.type === "break") continue;
      const rects = this.atomRects(atom);
      if (!rects.some((r) => rectsTouch(r, bounds))) {
        if (rects.length) flush();
        continue;
      }
      if (atom.type === "media") {
        if (inside(shape, center(rects[0]!))) {
          if (runStart < 0) runStart = atom.start;
          runEnd = atom.end;
        } else flush();
        continue;
      }
      const c = this.centers(atom);
      const data = atom.node.data;
      for (let i = 0; i < data.length; i++) {
        const x = c[i * 2]!;
        const y = c[i * 2 + 1]!;
        const blank = Number.isNaN(x) || /\s/.test(data[i]!);
        if (blank) continue;
        if (inside(shape, [x, y])) {
          if (runStart < 0) runStart = atom.start + i;
          runEnd = atom.start + i + 1;
        } else flush();
      }
    }
    flush();
    return normalize(out);
  }

  /** Boxes to test a brush against: the whole box of a simple block, or its own lines. */
  blockHitRects(block: Block): Rect[] {
    let list = this.blockRects.get(block);
    if (list) return list;
    if (block.leaf || block.kind === "media") {
      const r = block.el.getBoundingClientRect();
      list = r.width > 0 && r.height > 0 ? [this.local(r)] : [];
    } else {
      list = block.atoms.flatMap((a) => this.atomRects(a));
    }
    this.blockRects.set(block, list);
    return list;
  }

  /** Blocks that a brush of `radius` touches anywhere along the given points. */
  brushed(points: readonly Point[], radius: number): Block[] {
    if (!points.length) return [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of points) {
      x0 = Math.min(x0, x - radius); y0 = Math.min(y0, y - radius);
      x1 = Math.max(x1, x + radius); y1 = Math.max(y1, y + radius);
    }
    const bounds = { x0, y0, x1, y1 };
    const out: Block[] = [];
    for (const b of this.index.blocks) {
      const rects = this.blockHitRects(b);
      if (!rects.some((r) => rectsTouch(r, bounds))) continue;
      if (rects.some((r) => points.some((p) => circleTouchesRect(p, radius, r)))) out.push(b);
    }
    return out;
  }
}

/** The block under a viewport point, or null over empty space and over other UI. */
export function blockAtPoint(index: PageIndex, x: number, y: number, ignore: (el: Element) => boolean, shadowOf?: ShadowOf): Block | null {
  const doc = index.doc;
  const el = deepElementAt(doc, x, y, ignore, shadowOf);
  const block = index.blockFor(el);
  if (!block || block.leaf || block.kind === "media") return block;
  // A block that holds other blocks only counts where its own text is.
  const range = doc.createRange();
  for (const a of block.atoms) {
    if (a.type !== "text") continue;
    range.selectNodeContents(a.node);
    for (const r of range.getClientRects()) {
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 2 && y <= r.bottom + 2) return block;
    }
  }
  return null;
}

/** The text position under a viewport point, for the text tool. Looks inside the given shadow roots. */
export function caretAt(doc: Document, x: number, y: number, shadowRoots: ShadowRoot[] = []): { node: Node; offset: number } | null {
  const anyDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number, options?: { shadowRoots: ShadowRoot[] }) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (anyDoc.caretPositionFromPoint) {
    const p = anyDoc.caretPositionFromPoint(x, y, { shadowRoots });
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (anyDoc.caretRangeFromPoint) {
    const r = anyDoc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}


// The paint layer: the whole page is a canvas. It is cut into tiles that are made only where
// paint lands, placed in page coordinates, so the paint scrolls with the page without being
// redrawn. Paint is drawn opaque and the layer is shown see-through, so strokes that cross do
// not get darker. Each stroke is kept, so the layer can take any stroke out, put it back, and
// replay them all exactly after a change of zoom. The history of what was done lives with the
// brush, which knows about both of its layers.

import { segmentBounds, strokeTouchesRect, unionRect, type Point, type Rect } from "./geometry.js";

export interface Stroke {
  erase: boolean;
  radius: number;
  points: Point[];
  /** The mark the stroke belongs to: strokes made before a note share one mark. */
  mark: number;
}

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** A quarter-size copy that is never shown, for fast "is anything painted here" checks. */
  query: CanvasRenderingContext2D;
}

const TILE = 512;
const QUERY_SCALE = 0.25;
/** A pixel counts as painted from this alpha up, so the soft rim of a stroke does not. */
const PAINTED = 96;

export class PaintLayer {
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private readonly tiles = new Map<string, Tile>();
  private dpr: number;

  constructor(
    private readonly container: HTMLElement,
    private readonly color: string,
  ) {
    this.dpr = container.ownerDocument.defaultView?.devicePixelRatio || 1;
  }

  get isEmpty(): boolean {
    return !this.strokes.some((s) => !s.erase);
  }

  /** Starts a stroke and returns it, so it can be taken out or put back later. */
  begin(at: Point, radius: number, erase: boolean, mark: number): Stroke {
    this.current = { erase, radius, points: [at], mark };
    this.strokes.push(this.current);
    this.draw(this.current, 0);
    return this.current;
  }

  /** Drops the stroke in progress as if it never happened. */
  cancel(): void {
    const s = this.current;
    if (!s) return;
    this.current = null;
    this.remove(s);
  }

  /** Adds a point to the stroke in progress and draws the new piece. */
  extend(to: Point): void {
    const s = this.current;
    if (!s) return;
    const last = s.points[s.points.length - 1]!;
    if (Math.hypot(to[0] - last[0], to[1] - last[1]) < 0.5) return;
    s.points.push(to);
    this.draw(s, s.points.length - 1);
  }

  end(): void {
    this.current = null;
  }

  /** Takes a stroke out and returns where it was, or -1. */
  remove(s: Stroke): number {
    const i = this.strokes.indexOf(s);
    if (i < 0) return -1;
    this.strokes.splice(i, 1);
    this.redraw();
    return i;
  }

  /** Puts a stroke back where it was, so later erasing still covers it. */
  insert(s: Stroke, index: number): void {
    this.strokes.splice(Math.max(0, Math.min(index, this.strokes.length)), 0, s);
    this.redraw();
  }

  /** All strokes, oldest first, for clearing in one step that can be undone. */
  all(): Stroke[] {
    return [...this.strokes];
  }

  /** Puts back a list of strokes, replacing what is there. */
  replaceAll(strokes: Stroke[]): void {
    this.strokes = [...strokes];
    this.current = null;
    this.redraw();
  }

  /**
   * The newest paint stroke under a point, where paint still shows; null over bare page.
   * Erase strokes are never picked: they are not paint you can see.
   */
  strokeAt(p: Point): Stroke | null {
    if (!this.paintedIn({ x0: p[0] - 2, y0: p[1] - 2, x1: p[0] + 2, y1: p[1] + 2 })) return null;
    const dot = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]!;
      if (s.erase) continue;
      for (let j = 0; j < s.points.length; j++) {
        if (strokeTouchesRect(s.points[Math.max(0, j - 1)]!, s.points[j]!, s.radius, dot)) return s;
      }
    }
    return null;
  }

  /** Redraws everything when the screen's pixel ratio changes, so the paint stays sharp. */
  refresh(): void {
    const dpr = this.container.ownerDocument.defaultView?.devicePixelRatio || 1;
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.redraw();
  }

  /** The box around all paint, or null. */
  bounds(): Rect | null {
    let b: Rect | null = null;
    for (const s of this.strokes) {
      if (s.erase) continue;
      for (let i = 0; i < s.points.length; i++) b = unionRect(b, segmentBounds(s.points[i]!, s.points[Math.max(0, i - 1)]!, s.radius));
    }
    return b;
  }

  /** True when any painted pixel lies inside `r`, in page coordinates. */
  paintedIn(r: Rect): boolean {
    const t0x = Math.floor(r.x0 / TILE), t1x = Math.floor((r.x1 - 0.01) / TILE);
    const t0y = Math.floor(r.y0 / TILE), t1y = Math.floor((r.y1 - 0.01) / TILE);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const tile = this.tiles.get(`${tx},${ty}`);
        if (!tile) continue;
        const x0 = Math.max(r.x0, tx * TILE) - tx * TILE;
        const y0 = Math.max(r.y0, ty * TILE) - ty * TILE;
        const x1 = Math.min(r.x1, (tx + 1) * TILE) - tx * TILE;
        const y1 = Math.min(r.y1, (ty + 1) * TILE) - ty * TILE;
        const q = QUERY_SCALE;
        const px = Math.floor(x0 * q), py = Math.floor(y0 * q);
        const pw = Math.max(1, Math.ceil(x1 * q) - px), ph = Math.max(1, Math.ceil(y1 * q) - py);
        if (x1 <= x0 || y1 <= y0) continue;
        const data = tile.query.getImageData(px, py, pw, ph).data;
        for (let i = 3; i < data.length; i += 4) if (data[i]! >= PAINTED) return true;
      }
    }
    return false;
  }

  /** The share of a rectangle, in page coordinates, that paint covers: from 0 to 1. */
  coverage(r: Rect): number {
    const q = QUERY_SCALE;
    const px0 = Math.floor(r.x0 * q), px1 = Math.max(px0 + 1, Math.round(r.x1 * q));
    const py0 = Math.floor(r.y0 * q), py1 = Math.max(py0 + 1, Math.round(r.y1 * q));
    const size = TILE * q;
    let painted = 0;
    for (let ty = Math.floor(py0 / size); ty <= Math.floor((py1 - 1) / size); ty++) {
      for (let tx = Math.floor(px0 / size); tx <= Math.floor((px1 - 1) / size); tx++) {
        const tile = this.tiles.get(`${tx},${ty}`);
        if (!tile) continue;
        const x0 = Math.max(px0, tx * size) - tx * size, x1 = Math.min(px1, (tx + 1) * size) - tx * size;
        const y0 = Math.max(py0, ty * size) - ty * size, y1 = Math.min(py1, (ty + 1) * size) - ty * size;
        const data = tile.query.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let i = 3; i < data.length; i += 4) if (data[i]! >= PAINTED) painted++;
      }
    }
    return painted / ((px1 - px0) * (py1 - py0));
  }

  private redraw(): void {
    for (const t of this.tiles.values()) t.canvas.remove();
    this.tiles.clear();
    for (const s of this.strokes) this.draw(s, 0);
  }

  /** Draws a stroke from point `from` on: point 0 is a dab, each later point joins the one before. */
  private draw(s: Stroke, from: number): void {
    for (let i = from; i < s.points.length; i++) {
      const b = s.points[i]!;
      this.segment(i > 0 ? s.points[i - 1]! : b, b, s);
    }
  }

  private segment(a: Point, b: Point, s: Stroke): void {
    const box = segmentBounds(a, b, s.radius + 1);
    const t0x = Math.floor(box.x0 / TILE), t1x = Math.floor(box.x1 / TILE);
    const t0y = Math.floor(box.y0 / TILE), t1y = Math.floor(box.y1 / TILE);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const tile = s.erase ? this.tiles.get(`${tx},${ty}`) : this.tile(tx, ty);
        if (!tile) continue;
        for (const c of [tile.ctx, tile.query]) {
          c.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
          c.strokeStyle = c.fillStyle = s.erase ? "#000" : this.color;
          c.lineWidth = s.radius * 2;
          c.lineCap = "round";
          c.lineJoin = "round";
          c.beginPath();
          if (a[0] === b[0] && a[1] === b[1]) {
            c.arc(a[0], a[1], s.radius, 0, Math.PI * 2);
            c.fill();
          } else {
            c.moveTo(a[0], a[1]);
            c.lineTo(b[0], b[1]);
            c.stroke();
          }
        }
      }
    }
  }

  private tile(tx: number, ty: number): Tile {
    const key = `${tx},${ty}`;
    let t = this.tiles.get(key);
    if (t) return t;
    const doc = this.container.ownerDocument;
    const canvas = doc.createElement("canvas");
    canvas.width = Math.round(TILE * this.dpr);
    canvas.height = Math.round(TILE * this.dpr);
    canvas.style.cssText = `position:absolute;left:${tx * TILE}px;top:${ty * TILE}px;width:${TILE}px;height:${TILE}px;`;
    const ctx = canvas.getContext("2d")!;
    // Draw in page coordinates: one unit is one CSS pixel of the page.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, -tx * TILE * this.dpr, -ty * TILE * this.dpr);
    const small = doc.createElement("canvas");
    small.width = small.height = Math.round(TILE * QUERY_SCALE);
    const query = small.getContext("2d", { willReadFrequently: true })!;
    query.setTransform(QUERY_SCALE, 0, 0, QUERY_SCALE, -tx * TILE * QUERY_SCALE, -ty * TILE * QUERY_SCALE);
    this.container.append(canvas);
    t = { canvas, ctx, query };
    this.tiles.set(key, t);
    return t;
  }
}

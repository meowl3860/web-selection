// Plain geometry: rectangles, the outline around a union of rectangles, and hit tests for the
// marquee, lasso and brush. Nothing here touches the DOM, so it is all unit tested.

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Point = readonly [x: number, y: number];

/** A closed outline. The last point joins back to the first. */
export type Loop = Point[];

export function rect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0, y0, x1, y1 };
}

export function fromDOMRect(r: DOMRectReadOnly, dx = 0, dy = 0): Rect {
  return { x0: r.left + dx, y0: r.top + dy, x1: r.right + dx, y1: r.bottom + dy };
}

export function isEmptyRect(r: Rect): boolean {
  return !(r.x1 > r.x0 && r.y1 > r.y0);
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return isEmptyRect(r) ? null : r;
}

export function rectsTouch(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function area(r: Rect): number {
  return isEmptyRect(r) ? 0 : (r.x1 - r.x0) * (r.y1 - r.y0);
}

export function center(r: Rect): Point {
  return [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const b = { ...rects[0]! };
  for (const r of rects) {
    b.x0 = Math.min(b.x0, r.x0);
    b.y0 = Math.min(b.y0, r.y0);
    b.x1 = Math.max(b.x1, r.x1);
    b.y1 = Math.max(b.y1, r.y1);
  }
  return b;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

export function insideRect(p: Point, r: Rect): boolean {
  return p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
}

/** Even-odd ray casting. */
export function insidePolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBounds(poly: readonly Point[]): Rect | null {
  if (!poly.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

export function circleTouchesRect(c: Point, radius: number, r: Rect): boolean {
  const dx = c[0] - Math.max(r.x0, Math.min(c[0], r.x1));
  const dy = c[1] - Math.max(r.y0, Math.min(c[1], r.y1));
  return dx * dx + dy * dy <= radius * radius;
}

/** Points along a segment no further apart than `step`, including both ends. */
export function sampleSegment(a: Point, b: Point, step: number): Point[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / Math.max(1, step)));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

/**
 * The outline of the union of rectangles, as closed loops with the filled side on the right
 * of travel (screen coordinates, y down). Outer edges run clockwise and holes run the other
 * way, so the loops fill correctly with either fill rule. Two areas that touch only at a
 * corner stay separate loops.
 */
export function outline(rects: readonly Rect[]): Loop[] {
  const live = rects.filter((r) => !isEmptyRect(r));
  if (!live.length) return [];
  const xs = uniqueSorted(live.flatMap((r) => [r.x0, r.x1]));
  const ys = uniqueSorted(live.flatMap((r) => [r.y0, r.y1]));
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const W = xs.length - 1;
  const H = ys.length - 1;
  const filled = new Uint8Array(W * H);
  for (const r of live) {
    const i0 = xi.get(r.x0)!, i1 = xi.get(r.x1)!, j0 = yi.get(r.y0)!, j1 = yi.get(r.y1)!;
    for (let j = j0; j < j1; j++) filled.fill(1, j * W + i0, j * W + i1);
  }
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < W && j < H ? filled[j * W + i]! : 0);

  // Directed edges between grid vertices, keyed by their start vertex.
  type Edge = { a: number; b: number; used: boolean };
  const key = (i: number, j: number) => j * (W + 1) + i;
  const out = new Map<number, Edge[]>();
  const edges: Edge[] = [];
  const add = (ai: number, aj: number, bi: number, bj: number) => {
    const e = { a: key(ai, aj), b: key(bi, bj), used: false };
    edges.push(e);
    const list = out.get(e.a);
    if (list) list.push(e);
    else out.set(e.a, [e]);
  };
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i < W; i++) {
      const above = at(i, j - 1), below = at(i, j);
      if (below && !above) add(i, j, i + 1, j);
      else if (above && !below) add(i + 1, j, i, j);
    }
  }
  for (let i = 0; i <= W; i++) {
    for (let j = 0; j < H; j++) {
      const left = at(i - 1, j), right = at(i, j);
      if (right && !left) add(i, j + 1, i, j);
      else if (left && !right) add(i, j, i, j + 1);
    }
  }

  const vi = (k: number) => k % (W + 1);
  const vj = (k: number) => Math.floor(k / (W + 1));
  const dir = (e: Edge): Point => [Math.sign(vi(e.b) - vi(e.a)), Math.sign(vj(e.b) - vj(e.a))];
  const loops: Loop[] = [];
  for (const first of edges) {
    if (first.used) continue;
    const verts: number[] = [];
    let e: Edge | undefined = first;
    while (e && !e.used) {
      e.used = true;
      verts.push(e.a);
      const d = dir(e);
      const next: Edge[] = (out.get(e.b) ?? []).filter((n) => !n.used);
      // Prefer the sharpest right turn, so a pinch point keeps each area to its own loop.
      next.sort((p, q) => turn(d, dir(q)) - turn(d, dir(p)));
      e = next[0];
    }
    const pts: Point[] = verts.map((k) => [xs[vi(k)]!, ys[vj(k)]!]);
    const simple = dropCollinear(pts);
    if (simple.length >= 4) loops.push(simple);
  }
  return loops;
}

/** Positive for a right turn in y-down coordinates, zero for straight, negative for left. */
function turn(d1: Point, d2: Point): number {
  return d1[0] * d2[1] - d1[1] * d2[0];
}

function dropCollinear(pts: Point[]): Point[] {
  const n = pts.length;
  if (n < 3) return pts;
  const keep: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n]!, c = pts[i]!, q = pts[(i + 1) % n]!;
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross !== 0) keep.push(c);
  }
  return keep;
}

function uniqueSorted(values: number[]): number[] {
  const s = [...new Set(values)].sort((a, b) => a - b);
  return s;
}

/** An SVG path for loops; each loop is closed. */
export function loopsToPath(loops: readonly Loop[]): string {
  let d = "";
  for (const loop of loops) {
    loop.forEach(([x, y], i) => {
      d += (i ? "L" : "M") + fmt(x) + " " + fmt(y);
    });
    d += "Z";
  }
  return d;
}

export function polylineToPath(points: readonly Point[], close = false): string {
  if (!points.length) return "";
  let d = "";
  points.forEach(([x, y], i) => {
    d += (i ? "L" : "M") + fmt(x) + " " + fmt(y);
  });
  return close ? d + "Z" : d;
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

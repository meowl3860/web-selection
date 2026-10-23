// Plain geometry for the brush. Nothing here touches the DOM, so it is all unit tested.

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Point = readonly [x: number, y: number];


export function rectsTouch(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** The box around a brush stroke segment of radius `r`. */
export function segmentBounds(a: Point, b: Point, r: number): Rect {
  return { x0: Math.min(a[0], b[0]) - r, y0: Math.min(a[1], b[1]) - r, x1: Math.max(a[0], b[0]) + r, y1: Math.max(a[1], b[1]) + r };
}

function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x0 - p[0], 0, p[0] - r.x1);
  const dy = Math.max(r.y0 - p[1], 0, p[1] - r.y1);
  return Math.hypot(dx, dy);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, s: Point) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * True when a brush stroke from `a` to `b` with radius `r` touches the rectangle: the round
 * ends, the straight sides, or the path running through it.
 */
export function strokeTouchesRect(a: Point, b: Point, r: number, rect: Rect): boolean {
  if (!rectsTouch(segmentBounds(a, b, r), rect)) return false;
  if (distanceToRect(a, rect) <= r || distanceToRect(b, rect) <= r) return true;
  const corners: Point[] = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]];
  for (let i = 0; i < 4; i++) {
    if (segmentsCross(a, b, corners[i]!, corners[(i + 1) % 4]!)) return true;
    if (distanceToSegment(corners[i]!, a, b) <= r) return true;
  }
  return false;
}

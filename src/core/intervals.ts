// A selection is a mask over the page's reading order: a set of half-open intervals of
// positions, where each position is one character of text or one picture. Photoshop keeps a
// 2D mask of pixels; a page reads in one dimension, so its mask is a list of runs.

/** Positions `start` up to, but not including, `end`. */
export type Interval = readonly [start: number, end: number];

/** Sorted, with no empty, overlapping or touching intervals. */
export type IntervalSet = readonly Interval[];

export const EMPTY: IntervalSet = Object.freeze([]);

/** Sorts and merges any list of intervals into a set. */
export function normalize(list: readonly Interval[]): IntervalSet {
  const items = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of items) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function union(a: IntervalSet, b: IntervalSet): IntervalSet {
  if (!a.length) return b;
  if (!b.length) return a;
  return normalize([...a, ...b]);
}

export function subtract(a: IntervalSet, b: IntervalSet): IntervalSet {
  if (!a.length || !b.length) return a;
  const out: Interval[] = [];
  let j = 0;
  for (const [s0, e] of a) {
    let s = s0;
    while (j < b.length && b[j]![1] <= s) j++;
    let k = j;
    while (k < b.length && b[k]![0] < e) {
      const [bs, be] = b[k]!;
      if (bs > s) out.push([s, bs]);
      s = Math.max(s, be);
      if (s >= e) break;
      k++;
    }
    if (s < e) out.push([s, e]);
  }
  return out;
}

export function intersect(a: IntervalSet, b: IntervalSet): IntervalSet {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [as, ae] = a[i]!;
    const [bs, be] = b[j]!;
    const s = Math.max(as, bs);
    const e = Math.min(ae, be);
    if (s < e) out.push([s, e]);
    if (ae < be) i++;
    else j++;
  }
  return out;
}

export function size(a: IntervalSet): number {
  let n = 0;
  for (const [s, e] of a) n += e - s;
  return n;
}

export function equals(a: IntervalSet, b: IntervalSet): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return false;
  return true;
}

/** True when every position of `inner` is in `outer`. */
export function covers(outer: IntervalSet, inner: IntervalSet): boolean {
  return subtract(inner, outer).length === 0;
}

export function overlaps(a: IntervalSet, b: IntervalSet): boolean {
  return intersect(a, b).length > 0;
}

export type Mode = "new" | "add" | "subtract" | "intersect";

/** Applies a new region to the current selection the way Photoshop's four modes do. */
export function combine(current: IntervalSet, region: IntervalSet, mode: Mode): IntervalSet {
  switch (mode) {
    case "new":
      return region;
    case "add":
      return union(current, region);
    case "subtract":
      return subtract(current, region);
    case "intersect":
      return intersect(current, region);
  }
}

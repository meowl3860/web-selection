// The magic wand and the Select menu: Grow, Similar, Expand, Contract and Main text.
// All of them work on whole blocks in reading order, the way Photoshop's work on pixels.

import { flatContains, flatParent, inChrome, isFloating } from "./dom.js";
import { distance } from "./features.js";
import { normalize, type Interval, type IntervalSet } from "./intervals.js";
import type { Block, PageIndex } from "./page.js";

export class Wand {
  private readonly gaps = new Map<number, number>();
  private readonly groupRep: Block[] = [];

  constructor(private readonly index: PageIndex) {
    for (const b of index.blocks) if (!this.groupRep[b.group]) this.groupRep[b.group] = b;
  }

  distance(a: Block, b: Block): number {
    if (a.group === b.group) return 0;
    const lo = Math.min(a.group, b.group);
    const hi = Math.max(a.group, b.group);
    const key = lo * 65536 + hi;
    let d = this.gaps.get(key);
    if (d === undefined) {
      d = distance(this.groupRep[lo]!.features, this.groupRep[hi]!.features);
      this.gaps.set(key, d);
    }
    return d;
  }

  /** The blocks a wand click on `seed` takes. */
  pick(seed: Block, tolerance: number, contiguous: boolean): Block[] {
    const blocks = this.index.blocks;
    if (!contiguous) return blocks.filter((b) => this.distance(seed, b) <= tolerance);
    let lo = seed.order;
    let hi = seed.order;
    while (lo > 0 && this.distance(seed, blocks[lo - 1]!) <= tolerance) lo--;
    while (hi < blocks.length - 1 && this.distance(seed, blocks[hi + 1]!) <= tolerance) hi++;
    return blocks.slice(lo, hi + 1);
  }

  /** Photoshop's Grow: adds the neighbours that look like any selected block. */
  grow(selected: Block[], tolerance: number): Block[] {
    const blocks = this.index.blocks;
    const seeds = this.seedGroups(selected);
    const near = (b: Block) => seeds.some((s) => this.distance(s, b) <= tolerance);
    const keep = new Set(selected);
    for (const [lo, hi] of runs(selected)) {
      let i = lo;
      while (i > 0 && !keep.has(blocks[i - 1]!) && near(blocks[i - 1]!)) keep.add(blocks[--i]!);
      let j = hi;
      while (j < blocks.length - 1 && !keep.has(blocks[j + 1]!) && near(blocks[j + 1]!)) keep.add(blocks[++j]!);
    }
    return [...keep].sort((a, b) => a.order - b.order);
  }

  /** Photoshop's Similar: adds every block on the page that looks like a selected block. */
  similar(selected: Block[], tolerance: number): Block[] {
    const seeds = this.seedGroups(selected);
    return this.index.blocks.filter((b) => seeds.some((s) => this.distance(s, b) <= tolerance));
  }

  /** Adds one block at each end of each run. */
  expand(selected: Block[]): Block[] {
    const blocks = this.index.blocks;
    const keep = new Set(selected);
    for (const [lo, hi] of runs(selected)) {
      if (lo > 0) keep.add(blocks[lo - 1]!);
      if (hi < blocks.length - 1) keep.add(blocks[hi + 1]!);
    }
    return [...keep].sort((a, b) => a.order - b.order);
  }

  /** Removes one block from each end of each run. */
  contract(selected: Block[]): Block[] {
    const blocks = this.index.blocks;
    const drop = new Set<Block>();
    for (const [lo, hi] of runs(selected)) {
      drop.add(blocks[lo]!);
      drop.add(blocks[hi]!);
    }
    return selected.filter((b) => !drop.has(b));
  }

  /**
   * The main text of the page, like Photoshop's Select Subject: the container that holds the
   * most running text, without the menus, side bars and footers inside it.
   */
  mainText(): Block[] {
    const blocks = this.index.blocks;
    const prose = (b: Block) =>
      (b.kind === "paragraph" || b.kind === "text" || b.kind === "list-item" || b.kind === "quote") && b.textLength >= 25;
    // Each run of prose scores for every box around it. The main text is the tightest box
    // that holds most of the page's prose.
    const score = new Map<Element, number>();
    const depth = new Map<Element, number>();
    let total = 0;
    for (const b of blocks) {
      if (!prose(b) || inChrome(b.el) || isFloating(b.el)) continue;
      const s = 1 + Math.min(3, b.textLength / 100);
      total += s;
      for (let e = flatParent(b.el); e; e = flatParent(e)) score.set(e, (score.get(e) ?? 0) + s);
    }
    if (!total) return [];
    let best: Element | null = null;
    let bestDepth = -1;
    for (const [el, s] of score) {
      if (s < total * 0.7) continue;
      let d = depth.get(el);
      if (d === undefined) {
        d = 0;
        for (let e = flatParent(el); e; e = flatParent(e)) d++;
        depth.set(el, d);
      }
      if (d > bestDepth) {
        bestDepth = d;
        best = el;
      }
    }
    if (!best) return [];
    const container = best;
    return blocks.filter((b) => flatContains(container, b.el) && !inChrome(b.el, container) && !isFloating(b.el));
  }

  private seedGroups(selected: Block[]): Block[] {
    const seen = new Map<number, Block>();
    for (const b of selected) if (!seen.has(b.group)) seen.set(b.group, b);
    return [...seen.values()];
  }
}

/** Runs of blocks that follow each other in reading order, as [first order, last order]. */
export function runs(selected: Block[]): [number, number][] {
  const orders = [...new Set(selected.map((b) => b.order))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const o of orders) {
    const last = out[out.length - 1];
    if (last && o === last[1] + 1) last[1] = o;
    else out.push([o, o]);
  }
  return out;
}

export function spanOfBlocks(blocks: Iterable<Block>): IntervalSet {
  const list: Interval[] = [];
  for (const b of blocks) list.push(...b.span);
  return normalize(list);
}

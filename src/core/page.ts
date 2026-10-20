// The page index: every visible character and picture gets a position in reading order, and
// every position belongs to a block. A block is the innermost box that lays out its own lines
// of text (a paragraph, a list item, a table cell, a card title), or a picture big enough to
// stand alone. The index walks the flat tree, so text inside shadow roots and slots counts.
// It is rebuilt when the page changes; positions are only valid for the index that made them.

import { flatContains, flatParent, openShadow, type ShadowOf } from "./dom.js";
import { readFeatures, signature, type Features } from "./features.js";
import { normalize, type Interval, type IntervalSet } from "./intervals.js";

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list-item"
  | "code"
  | "quote"
  | "cell"
  | "caption"
  | "term"
  | "media"
  | "text";

interface AtomBase {
  start: number;
  end: number;
  block: Block;
  /** The document or shadow root the atom lives in. A DOM range cannot cross between roots. */
  root: Node;
}
export interface TextAtom extends AtomBase {
  type: "text";
  node: Text;
}
export interface MediaAtom extends AtomBase {
  type: "media";
  el: Element;
}
/** A line break from `<br>`. It has a position so text keeps its lines, but no box. */
export interface BreakAtom extends AtomBase {
  type: "break";
  el: Element;
}
export type Atom = TextAtom | MediaAtom | BreakAtom;

export function atomNode(a: Atom): Node {
  return a.type === "text" ? a.node : a.el;
}

export interface Block {
  /** Reading order: the order of the block's first atom. */
  order: number;
  el: Element;
  kind: BlockKind;
  atoms: Atom[];
  /** The positions the block owns. A block that holds other blocks owns only its own text. */
  span: IntervalSet;
  /** False when other blocks sit inside this one. */
  leaf: boolean;
  textLength: number;
  features: Features;
  /** Blocks with the same look share a group, so the wand compares groups, not blocks. */
  group: number;
}

export interface IndexOptions {
  root: Element;
  /** Elements to leave out, with everything inside them. */
  exclude?: (el: Element) => boolean;
  /** How to reach shadow roots. The default reaches open ones. */
  shadowOf?: ShadowOf;
}

const SKIP = new Set([
  "script", "style", "noscript", "template", "head", "title", "meta", "link", "base",
  "input", "textarea", "select", "option", "optgroup", "datalist", "button",
]);
const MEDIA = new Set(["img", "svg", "video", "canvas", "iframe", "object", "embed", "audio", "math"]);
/** A picture at least this big stands as its own block; smaller ones sit inside the text. */
const STANDALONE_W = 80;
const STANDALONE_H = 56;

export interface Piece {
  atom: Atom;
  /** Offsets inside the atom. For a text atom they are offsets into the text node. */
  from: number;
  to: number;
}

export class PageIndex {
  readonly atoms: Atom[] = [];
  readonly blocks: Block[] = [];
  /** Shadow roots the index walked, so callers can watch them for changes. */
  readonly shadowRoots: ShadowRoot[] = [];
  readonly total: number;
  readonly version: number;
  readonly doc: Document;
  private readonly atomOf = new Map<Node, Atom>();
  private readonly blockOf = new Map<Element, Block>();

  constructor(opts: IndexOptions, version = 0) {
    this.version = version;
    this.doc = opts.root.ownerDocument;
    new Builder(opts, this.atoms, this.blocks, this.atomOf, this.blockOf, this.shadowRoots).run();
    this.total = this.atoms.length ? this.atoms[this.atoms.length - 1]!.end : 0;
  }

  universe(): IntervalSet {
    return this.total ? [[0, this.total]] : [];
  }

  /** The atom that holds position `pos`. */
  atomAt(pos: number): Atom | null {
    const i = this.atomIndexAt(pos);
    const a = this.atoms[i];
    return a && pos >= a.start && pos < a.end ? a : null;
  }

  /** The index of the atom that holds `pos`, or of the first atom after it. */
  atomIndexAt(pos: number): number {
    const a = this.atoms;
    let lo = 0;
    let hi = a.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const m = a[mid]!;
      if (pos < m.start) hi = mid - 1;
      else if (pos >= m.end) lo = mid + 1;
      else return mid;
    }
    return lo;
  }

  atomOfNode(node: Node): Atom | undefined {
    return this.atomOf.get(node);
  }

  blockOfElement(el: Element): Block | undefined {
    return this.blockOf.get(el);
  }

  /** The nearest block at or above `el` in the flat tree. */
  blockFor(el: Element | null): Block | null {
    for (let e: Element | null = el; e; e = flatParent(e)) {
      const b = this.blockOf.get(e);
      if (b) return b;
    }
    return null;
  }

  /**
   * The position of a DOM boundary point. A point inside an indexed text node maps exactly;
   * a point between nodes goes to the next atom after it in the same tree.
   */
  position(node: Node, offset: number): number {
    const atom = this.atomOf.get(node);
    if (atom && atom.type === "text") return atom.start + Math.max(0, Math.min(offset, atom.end - atom.start));
    const root = node.getRootNode();
    let next: Node | null;
    if (node.nodeType === Node.TEXT_NODE) next = after(node, root);
    else next = node.childNodes[offset] ?? after(node, root);
    if (!next) return this.total;
    const walker = this.doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    walker.currentNode = next;
    for (let n: Node | null = next; n; n = walker.nextNode()) {
      const a = this.atomOf.get(n);
      if (a) return a.start;
    }
    return this.total;
  }

  /** DOM ranges for positions `start` to `end`, one for each document or shadow root crossed. */
  rangesOf([start, end]: Interval): Range[] {
    const out: Range[] = [];
    let i = this.atomIndexAt(start);
    while (i < this.atoms.length && this.atoms[i]!.start < end) {
      const first = this.atoms[i]!;
      let j = i;
      while (j + 1 < this.atoms.length && this.atoms[j + 1]!.start < end && this.atoms[j + 1]!.root === first.root) j++;
      const last = this.atoms[j]!;
      const r = this.doc.createRange();
      if (first.type === "text") r.setStart(first.node, Math.max(start, first.start) - first.start);
      else r.setStartBefore(first.el);
      if (last.type === "text") r.setEnd(last.node, Math.min(end, last.end) - last.start);
      else r.setEndAfter(last.el);
      out.push(r);
      i = j + 1;
    }
    return out;
  }

  /** One DOM range for positions `start` to `end`, when they share a root. */
  rangeOf(iv: Interval): Range | null {
    return this.rangesOf(iv)[0] ?? null;
  }

  /** The interval set that a DOM range covers. */
  setOfRange(r: Range): IntervalSet {
    const s = this.position(r.startContainer, r.startOffset);
    const e = this.position(r.endContainer, r.endOffset);
    return e > s ? [[s, e]] : [];
  }

  /** The positions of every atom inside an element, through shadow roots too. */
  setOfElement(el: Element): IntervalSet {
    const list: Interval[] = [];
    for (const a of this.atoms) if (flatContains(el, atomNode(a))) list.push([a.start, a.end]);
    return normalize(list);
  }

  /** The pieces of each atom that a set covers, in reading order. */
  pieces(set: IntervalSet): Piece[] {
    const out: Piece[] = [];
    for (const [s, e] of set) {
      for (let i = this.atomIndexAt(s); i < this.atoms.length; i++) {
        const atom = this.atoms[i]!;
        if (atom.start >= e) break;
        const from = Math.max(s, atom.start) - atom.start;
        const to = Math.min(e, atom.end) - atom.start;
        if (to > from) out.push({ atom, from, to });
      }
    }
    return out;
  }

  /** Blocks that the set touches, in reading order. */
  blocksOf(set: IntervalSet): Block[] {
    const seen = new Set<Block>();
    for (const p of this.pieces(set)) seen.add(p.atom.block);
    return [...seen].sort((a, b) => a.order - b.order);
  }

  /** Drops runs that hold only spaces or nothing visible, and trims spaces off both ends. */
  tidy(set: IntervalSet): IntervalSet {
    const out: Interval[] = [];
    for (const iv of set) {
      let [s, e] = iv;
      while (s < e && this.isBlank(s)) s++;
      while (e > s && this.isBlank(e - 1)) e--;
      if (e > s) out.push([s, e]);
    }
    return out;
  }

  private isBlank(pos: number): boolean {
    const a = this.atomAt(pos);
    if (!a) return true;
    if (a.type !== "text") return a.type === "break";
    const ch = a.node.data.charCodeAt(pos - a.start);
    return ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12 || ch === 160 || ch === 0x200b;
  }
}

/** The first node after `node` and everything inside it, within `root`. */
function after(node: Node, root: Node): Node | null {
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) if (n.nextSibling) return n.nextSibling;
  return null;
}

type Verdict = "reject" | "enter" | "media" | "break";

class Builder {
  private pos = 0;
  private readonly nearest = new Map<Element, Element | null>();
  private readonly visible = new Map<Element, boolean>();
  private readonly groups = new Map<string, number>();
  private readonly ids = new WeakMap<Element, number>();
  private nextId = 1;
  private readonly shadowOf: ShadowOf;

  constructor(
    private readonly opts: IndexOptions,
    private readonly atoms: Atom[],
    private readonly blocks: Block[],
    private readonly atomOf: Map<Node, Atom>,
    private readonly blockOf: Map<Element, Block>,
    private readonly roots: ShadowRoot[],
  ) {
    this.shadowOf = opts.shadowOf ?? openShadow;
  }

  run(): void {
    // Depth first in flat-tree order, with an explicit stack so deep pages cannot overflow it.
    const stack: Node[] = [this.opts.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.nodeType === Node.TEXT_NODE) {
        this.addText(n as Text);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      const verdict = this.judge(el);
      if (verdict === "reject") continue;
      if (verdict === "break") {
        this.addBreak(el);
        continue;
      }
      if (verdict === "media") {
        this.addMedia(el);
        continue;
      }
      let kids: ArrayLike<Node>;
      if (el.localName === "slot") {
        const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
        kids = assigned.length ? assigned : el.childNodes;
      } else {
        const shadow = this.shadowOf(el);
        if (shadow) {
          this.roots.push(shadow);
          kids = shadow.childNodes;
        } else kids = el.childNodes;
      }
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    this.finish();
  }

  private judge(el: Element): Verdict {
    const tag = el.localName;
    if (SKIP.has(tag) || this.opts.exclude?.(el)) return "reject";
    if (tag === "dialog" && !(el as HTMLDialogElement).open) return "reject";
    if (tag === "br") return "break";
    if (typeof el.checkVisibility === "function" && !el.checkVisibility()) {
      // `display: contents` has no box of its own, but its children have boxes.
      return getComputedStyle(el).display === "contents" ? "enter" : "reject";
    }
    return MEDIA.has(tag) ? "media" : "enter";
  }

  private addText(node: Text): void {
    const data = node.data;
    if (!/\S/.test(data)) return;
    const parent = flatParent(node);
    if (!parent || !this.isVisible(parent)) return;
    const blockEl = this.blockElementOf(parent);
    if (!blockEl) return;
    const block = this.blockFor(blockEl, false);
    if (!block) return;
    this.push({ type: "text", node, start: this.pos, end: this.pos + data.length, block, root: node.getRootNode() });
  }

  private addBreak(el: Element): void {
    const parent = flatParent(el);
    const blockEl = parent ? this.blockElementOf(parent) : null;
    const block = blockEl ? this.blockOf.get(blockEl) : undefined;
    // A break only matters between text of a block that already exists.
    if (!block) return;
    this.push({ type: "break", el, start: this.pos, end: this.pos + 1, block, root: el.getRootNode() });
  }

  private addMedia(el: Element): void {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (!this.isVisible(el)) return;
    let block: Block | null;
    if (r.width >= STANDALONE_W && r.height >= STANDALONE_H) block = this.blockFor(el, true);
    else {
      const parent = flatParent(el);
      const blockEl = parent ? this.blockElementOf(parent) : null;
      block = blockEl ? this.blockFor(blockEl, false) : null;
    }
    if (!block) return;
    this.push({ type: "media", el, start: this.pos, end: this.pos + 1, block, root: el.getRootNode() });
  }

  private push(atom: Atom): void {
    this.pos = atom.end;
    this.atoms.push(atom);
    atom.block.atoms.push(atom);
    this.atomOf.set(atomNode(atom), atom);
  }

  private blockFor(el: Element, media: boolean): Block | null {
    const have = this.blockOf.get(el);
    if (have) return have;
    if (!media) {
      // A box with no size is hidden on purpose (screen-reader text, collapsed menus).
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return null;
    }
    const block: Block = {
      order: this.blocks.length,
      el,
      kind: media ? "media" : "text",
      atoms: [],
      span: [],
      leaf: true,
      textLength: 0,
      features: undefined as unknown as Features,
      group: 0,
    };
    this.blocks.push(block);
    this.blockOf.set(el, block);
    return block;
  }

  /** The innermost flat-tree ancestor that lays out lines: anything whose display is not inline. */
  private blockElementOf(el: Element): Element | null {
    const root = this.opts.root;
    const path: Element[] = [];
    let found: Element | null = null;
    for (let e: Element | null = el; e; e = flatParent(e)) {
      const known = this.nearest.get(e);
      if (known !== undefined) {
        found = known;
        break;
      }
      path.push(e);
      if (isBlockLevel(e)) {
        found = e;
        break;
      }
      if (e === root) break;
    }
    for (const p of path) this.nearest.set(p, found);
    return found;
  }

  private isVisible(el: Element): boolean {
    let v = this.visible.get(el);
    if (v !== undefined) return v;
    if (typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) v = true;
    else {
      // `display: contents` has no box, so ask its own visibility and its parent instead.
      const cs = getComputedStyle(el);
      const up = flatParent(el);
      v = cs.display === "contents" && cs.visibility === "visible" && (up ? this.isVisible(up) : true);
    }
    this.visible.set(el, v);
    return v;
  }

  private finish(): void {
    const blocks = this.blocks;
    // Blocks with no atoms can appear when a block's only text was hidden.
    const live = blocks.filter((b) => b.atoms.length);
    blocks.length = 0;
    live.sort((a, b) => a.atoms[0]!.start - b.atoms[0]!.start);
    live.forEach((b, i) => {
      b.order = i;
      blocks.push(b);
    });
    for (const [el, b] of [...this.blockOf]) if (!b.atoms.length) this.blockOf.delete(el);
    for (const b of blocks) {
      b.span = normalize(b.atoms.map((a) => [a.start, a.end] as Interval));
      b.textLength = b.atoms.reduce((n, a) => n + (a.type === "text" ? a.node.data.trim().length : 0), 0);
      for (let e = flatParent(b.el); e; e = flatParent(e)) {
        const up = this.blockOf.get(e);
        if (up) {
          up.leaf = false;
          break;
        }
      }
    }
    for (const b of blocks) {
      b.features = readFeatures(b, (el) => this.idOf(el));
      b.kind = b.features.kind;
      const sig = signature(b.features);
      let g = this.groups.get(sig);
      if (g === undefined) {
        g = this.groups.size;
        this.groups.set(sig, g);
      }
      b.group = g;
    }
  }

  private idOf(el: Element): number {
    let id = this.ids.get(el);
    if (!id) {
      id = this.nextId++;
      this.ids.set(el, id);
    }
    return id;
  }
}

function isBlockLevel(el: Element): boolean {
  const d = getComputedStyle(el).display;
  if (d === "contents") return false;
  return !(d.startsWith("inline") || d.startsWith("ruby"));
}

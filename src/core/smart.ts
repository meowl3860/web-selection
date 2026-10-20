// Smart select, like Photoshop's Object Selection: the pointer finds the part of the page that
// belongs together, and a click takes all of it. A list comes with the sentence that leads into
// it, a picture with its caption, a term with its definition, a card or a note box whole.
// A heading takes its section. Clicking inside the selection again takes the section around it,
// under its title, then the section around that.

import { hasOwnBox } from "./features.js";
import { flatContains, flatParent, inChrome, isFloating } from "./dom.js";
import type { Block, PageIndex } from "./page.js";

export type Reach = "part" | "section";

/** Containers that hold a whole page or article; a part never grows past them. */
const PAGE_LEVEL = new Set(["body", "html", "main", "article"]);
const LISTS = new Set(["ul", "ol", "menu"]);
/** Elements that hold a heading of their own: a card's or a table's title is not a page title. */
const HOLDERS = new Set(["figure", "table", "aside", "details", "dialog", "blockquote", "li", "nav", "td", "th", "dd", "form", "fieldset"]);
const PROSE = new Set(["paragraph", "text", "list-item", "quote"]);

export class Smart {
  private readonly units = new Map<Block, Block[]>();

  constructor(private readonly index: PageIndex) {}

  /** What a click on `block` takes. */
  pick(block: Block, reach: Reach): Block[] {
    if (reach === "section") {
      const head = block.kind === "heading" ? block : titlePath(this.index, block).at(-1);
      if (head) {
        const sec = this.section(head);
        if (sec.includes(block)) return sec;
      }
    }
    return this.unit(block);
  }

  /** The block with what belongs to it. */
  unit(block: Block): Block[] {
    let u = this.units.get(block);
    if (!u) {
      u = this.findUnit(block);
      this.units.set(block, u);
    }
    return u;
  }

  /**
   * The next larger part around the selected blocks: the smallest section under a title that
   * holds all of them and more. Null when the selection already covers its outermost section.
   */
  grow(selected: Block[]): Block[] | null {
    if (!selected.length) return null;
    const first = selected.reduce((a, b) => (a.order < b.order ? a : b));
    const have = new Set(selected);
    const heads = titlePath(this.index, first);
    if (first.kind === "heading") heads.push(first);
    for (let i = heads.length - 1; i >= 0; i--) {
      const sec = this.section(heads[i]!);
      if (sec.length > have.size && selected.every((b) => sec.includes(b))) return sec;
    }
    return null;
  }

  /**
   * A heading and everything under it, up to the next heading of the same or a higher level.
   * A heading in a card or a note heads only that box; other headings head the main content.
   */
  section(head: Block): Block[] {
    const blocks = this.index.blocks;
    const level = head.features.level || 6;
    const scope = headingScope(head);
    const floats = isFloating(head.el);
    const out = [head];
    for (let i = head.order + 1; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (!flatContains(scope, b.el)) break;
      if (b.kind === "heading" && (b.features.level || 6) <= level) break;
      if (inChrome(b.el, scope) || (!floats && isFloating(b.el))) continue;
      out.push(b);
    }
    return out;
  }

  private findUnit(block: Block): Block[] {
    if (block.kind === "heading") return this.section(block);
    let list: Element | null = null;
    for (let e: Element | null = block.el, depth = 0; e && depth < 12; e = flatParent(e), depth++) {
      const tag = e.localName;
      if (LISTS.has(tag)) {
        list = e;
        continue;
      }
      if (list && tag !== "li") return this.withLeadIn(this.inside(list), list);
      if (PAGE_LEVEL.has(tag) || e.getAttribute("role") === "main") break;
      if (tag === "figure" || tag === "blockquote" || tag === "details") return this.inside(e);
      if (tag === "table" || tag === "pre") return this.withLeadIn(this.inside(e), e);
      if (tag === "dt" || tag === "dd") return this.termGroup(block, e);
      if (e !== block.el && this.isBox(e)) return this.inside(e);
    }
    if (list) return this.withLeadIn(this.inside(list), list);
    return [block];
  }

  private inside(el: Element): Block[] {
    return this.index.blocks.filter((b) => flatContains(el, b.el));
  }

  /** Adds the sentence just before a list, table or code block that leads into it with a colon. */
  private withLeadIn(blocks: Block[], container: Element): Block[] {
    const first = blocks[0];
    if (!first) return blocks;
    const prev = this.index.blocks[first.order - 1];
    if (!prev || !PROSE.has(prev.kind) || flatContains(container, prev.el)) return blocks;
    const text = (prev.el.textContent ?? "").trim();
    if (!/[:：]$/.test(text)) return blocks;
    const a = prev.el.getBoundingClientRect();
    const b = container.getBoundingClientRect();
    return b.top - a.bottom < 48 ? [prev, ...blocks] : blocks;
  }

  /** A term with its definitions, or a definition with its terms. */
  private termGroup(block: Block, item: Element): Block[] {
    const dl = flatParent(item);
    if (!dl || dl.localName !== "dl") return [block];
    const kids = [...dl.children].filter((c) => c.localName === "dt" || c.localName === "dd");
    let i = kids.indexOf(item);
    while (i > 0 && !(kids[i]!.localName === "dt" && kids[i - 1]!.localName === "dd")) i--;
    let j = i;
    while (j + 1 < kids.length && !(kids[j + 1]!.localName === "dt" && kids[j]!.localName === "dd")) j++;
    const group = kids.slice(i, j + 1);
    return this.index.blocks.filter((b) => group.some((g) => flatContains(g, b.el)));
  }

  /** A card or a note: a box of its own holding a few blocks. */
  private isBox(el: Element): boolean {
    if (!hasOwnBox(el)) return false;
    const inside = this.inside(el);
    if (inside.length < 2 || inside.length > 12) return false;
    return inside.reduce((n, b) => n + b.textLength, 0) <= 1500;
  }
}

/** The headings above a block, outermost first: for a paragraph under h3, its h1, h2 and h3. */
export function titlePath(index: PageIndex, block: Block): Block[] {
  const out: Block[] = [];
  let below = block.kind === "heading" ? block.features.level || 6 : 7;
  for (let i = block.order - 1; i >= 0 && below > 1; i--) {
    const b = index.blocks[i]!;
    if (b.kind !== "heading" || inChrome(b.el)) continue;
    const level = b.features.level || 6;
    // A heading inside a box that does not hold the block is that box's own title.
    if (level < below && flatContains(headingScope(b), block.el)) {
      out.unshift(b);
      below = level;
    }
  }
  return out;
}

const scopes = new WeakMap<Block, Element>();

/** Where a heading's section can reach: the box it sits in, or else the main content. */
export function headingScope(head: Block): Element {
  let scope = scopes.get(head);
  if (scope) return scope;
  scope = head.el.ownerDocument.body;
  for (let e = flatParent(head.el); e; e = flatParent(e)) {
    const tag = e.localName;
    if (PAGE_LEVEL.has(tag) || e.getAttribute("role") === "main") {
      scope = e;
      break;
    }
    if (HOLDERS.has(tag) || (tag !== "header" && hasOwnBox(e))) {
      scope = e;
      break;
    }
  }
  scopes.set(head, scope);
  return scope;
}

/** The nearest block of running text before or after a run, inside the same section. */
export function nearby(index: PageIndex, from: Block, step: 1 | -1, skip: Set<Block>): Block | null {
  for (let i = from.order + step; i >= 0 && i < index.blocks.length; i += step) {
    const b = index.blocks[i]!;
    if (skip.has(b)) continue;
    if (b.kind === "heading") return null;
    if (inChrome(b.el)) continue;
    // Short labels such as "Note" say little; the text after them is the context.
    if (b.textLength < 25) continue;
    if (PROSE.has(b.kind) || b.kind === "code" || b.kind === "caption") return b;
  }
  return null;
}


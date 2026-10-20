// What a consumer gets back: the selection as blocks, text and ranges. A snapshot is made
// for one index and stays readable after the page changes, though its ranges are live DOM
// ranges and follow the page.

import type { IntervalSet } from "./intervals.js";
import type { Block, BlockKind, PageIndex, Piece } from "./page.js";
import { nearby, titlePath } from "./smart.js";

export interface Part {
  /** The block element: a paragraph, list item, cell, picture and so on. */
  block: Element;
  kind: BlockKind;
  /** True when the whole block is selected, not only some of its text. */
  whole: boolean;
  text: string;
  range: Range;
}

export interface Context {
  /** The headings above the selection, outermost first. */
  titles: string[];
  /** The running text just before the selection, in the same section. */
  before: string;
  /** The running text just after the selection, in the same section. */
  after: string;
}

export interface Stats {
  blocks: number;
  words: number;
  characters: number;
  pictures: number;
}

export class SelectionSnapshot {
  private partsCache: Part[] | null = null;

  constructor(
    private readonly index: PageIndex | null,
    /** The selection as positions in its index. */
    readonly set: IntervalSet,
  ) {}

  get isEmpty(): boolean {
    return this.set.length === 0;
  }

  /** The selected part of each block, in reading order. */
  get parts(): Part[] {
    if (this.partsCache) return this.partsCache;
    const index = this.index;
    if (!index || !this.set.length) return (this.partsCache = []);
    const map = new Map<Block, Piece[]>();
    for (const p of index.pieces(this.set)) {
      const list = map.get(p.atom.block);
      if (list) list.push(p);
      else map.set(p.atom.block, [p]);
    }
    const out: Part[] = [];
    for (const [block, pieces] of [...map].sort((a, b) => a[0].order - b[0].order)) {
      const text = textOf(block, pieces);
      const first = pieces[0]!;
      const last = pieces[pieces.length - 1]!;
      const range = index.rangeOf([first.atom.start + first.from, last.atom.start + last.to]);
      if (!range) continue;
      const whole = index.covers(this.set, block.span);
      if (!text && block.kind !== "media") continue;
      out.push({ block: block.el, kind: block.kind, whole, text, range });
    }
    return (this.partsCache = out);
  }

  get blocks(): Element[] {
    return this.parts.map((p) => p.block);
  }

  get media(): Element[] {
    const index = this.index;
    if (!index) return [];
    return index.pieces(this.set).flatMap((p) => (p.atom.type === "media" ? [p.atom.el] : []));
  }

  /** Fresh static copies of the selected ranges, one per run. */
  ranges(): Range[] {
    const index = this.index;
    if (!index) return [];
    return this.set.flatMap((iv) => index.rangesOf(iv));
  }

  /** The selected text, one block per line group, with list items marked. */
  text(): string {
    const parts = this.parts;
    let out = "";
    parts.forEach((p, i) => {
      if (i) {
        const prev = parts[i - 1]!;
        const tight = prev.kind === p.kind && (p.kind === "list-item" || p.kind === "cell" || p.kind === "term");
        out += tight ? "\n" : "\n\n";
      }
      out += p.kind === "list-item" && p.whole ? bullet(p.block) + p.text : p.text;
    });
    return out;
  }

  /**
   * Where the selection sits: the titles above it, outermost first, and the running text just
   * before and after it in the same section. A tool that explains the selection can send this
   * along, so the answer knows the topic without the whole page.
   */
  context(maxChars = 600): Context {
    const index = this.index;
    const blocks = index ? index.blocksOf(this.set) : [];
    if (!index || !blocks.length) return { titles: [], before: "", after: "" };
    const skip = new Set(blocks);
    const text = (b: Block | null) => (b ? textOf(b, index.pieces(b.span)) : "");
    const before = text(nearby(index, blocks[0]!, -1, skip));
    const after = text(nearby(index, blocks[blocks.length - 1]!, 1, skip));
    return {
      titles: titlePath(index, blocks[0]!).map((h) => text(h)),
      before: before.length > maxChars ? "…" + before.slice(-maxChars) : before,
      after: after.length > maxChars ? after.slice(0, maxChars) + "…" : after,
    };
  }

  get stats(): Stats {
    const parts = this.parts;
    let words = 0;
    let characters = 0;
    for (const p of parts) {
      characters += p.text.replace(/\s+/g, "").length;
      words += countWords(p.text);
    }
    return { blocks: parts.length, words, characters, pictures: this.media.length };
  }
}

function textOf(block: Block, pieces: Piece[]): string {
  // Lines split at each <br>. Inside a line, the source's spaces and line ends collapse.
  // Runs that do not touch, such as the line pieces a marquee takes, are joined by an ellipsis.
  const lines = [""];
  let end = -1;
  for (const p of pieces) {
    const a = p.atom;
    if (end >= 0 && a.start + p.from > end) lines[lines.length - 1] += " … ";
    end = a.start + p.to;
    if (a.type === "break") lines.push("");
    else lines[lines.length - 1] += a.type === "text" ? a.node.data.slice(p.from, p.to) : mediaText(a.el);
  }
  if (block.features.pre) return lines.join("\n").replace(/^\n+|\s+$/g, "");
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).join("\n").trim();
}

function mediaText(el: Element): string {
  if (el.localName === "math") return el.getAttribute("alttext") || el.textContent?.trim() || "";
  const label = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") ||
    (el.localName === "svg" ? el.querySelector("title")?.textContent : "") || "";
  const kind = el.localName === "video" ? "video" : el.localName === "iframe" ? "frame" : "picture";
  return label.trim() ? `[${kind}: ${label.trim()}]` : `[${kind}]`;
}

function bullet(li: Element): string {
  const list = li.parentElement;
  if (list?.localName === "ol") {
    const items = [...list.children].filter((c) => c.localName === "li");
    const start = (list as HTMLOListElement).start || 1;
    return `${start + items.indexOf(li)}. `;
  }
  return "- ";
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/** Words for spaced scripts; each character counts as a word in Chinese and Japanese. */
export function countWords(s: string): number {
  const cjk = s.match(CJK)?.length ?? 0;
  const rest = s.replace(CJK, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return cjk + rest;
}

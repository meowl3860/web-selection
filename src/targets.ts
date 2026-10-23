// What the brush can select: the elements a person sees as one thing on the page. A text
// element is the innermost box that lays out its own lines (a paragraph, a list item, a cell,
// a card title). Pictures, videos and frames large enough to stand alone are elements of their
// own, and so are buttons and fields. A project can name the elements that count instead; then
// each named element is one target, with the text inside it. The walk follows the flat tree, so
// text in shadow roots, slots and `display: contents` boxes counts.

import { flatParent, type ShadowOf } from "./dom.js";

export type TargetKind = "text" | "media" | "control";

export interface Target {
  el: Element;
  kind: TargetKind;
  /** Reading order. */
  order: number;
  /** False when other targets sit inside this one; then only its own text counts as its area. */
  leaf: boolean;
  /** The text nodes that belong to this element itself. */
  texts: Text[];
}

const SKIP = new Set(["script", "style", "noscript", "template", "head", "title", "meta", "link", "base", "option", "optgroup", "datalist"]);
const CONTROLS = new Set(["input", "textarea", "select", "button"]);
const MEDIA = new Set(["img", "svg", "video", "canvas", "iframe", "object", "embed", "audio", "math"]);
/** A picture at least this big is an element of its own; a smaller one belongs to its text. */
const STANDALONE_W = 48;
const STANDALONE_H = 40;

export interface FindOptions {
  root: Element;
  exclude: (el: Element) => boolean;
  shadowOf: ShadowOf;
  /** Only these elements count, each with the text inside it. By default the finder decides. */
  only?: ((el: Element) => boolean) | undefined;
}

export function findTargets(opts: FindOptions): Target[] {
  const finder = new TargetFinder(opts);
  finder.step(Infinity);
  return finder.targets;
}

/**
 * Walks the page for targets, a part at a time: `step` stops when the time is up and goes on
 * where it stopped the next time, so a page with tens of thousands of elements never stalls a
 * frame. The targets are complete once `step` returns true.
 */
export class TargetFinder {
  readonly targets: Target[] = [];
  private readonly byEl = new Map<Element, Target>();
  private readonly nearest = new Map<Element, Element | null>();
  private readonly visible = new Map<Element, boolean>();
  // Depth first in flat-tree order, with an explicit stack so deep pages cannot overflow it.
  private readonly stack: Node[];
  private done = false;

  constructor(private readonly opts: FindOptions) {
    this.stack = [opts.root];
  }

  /** Walks on until `until`, a time from performance.now(); true when every target is found. */
  step(until: number): boolean {
    if (this.done) return true;
    const stack = this.stack;
    let count = 0;
    while (stack.length) {
      // Looking at the clock costs too, so only every so many nodes.
      if (++count % 256 === 0 && performance.now() > until) return false;
      const n = stack.pop()!;
      if (n.nodeType === Node.TEXT_NODE) {
        if (this.opts.only) this.addNamedText(n as Text);
        else this.addText(n as Text);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      const tag = el.localName;
      if (SKIP.has(tag) || this.opts.exclude(el)) continue;
      if (tag === "dialog" && !(el as HTMLDialogElement).open) continue;
      if (typeof el.checkVisibility === "function" && !el.checkVisibility()) {
        // `display: contents` has no box of its own, but its children have boxes.
        if (getComputedStyle(el).display !== "contents") continue;
      }
      if (this.opts.only) {
        if (this.opts.only(el)) this.addNamed(el);
        if (MEDIA.has(tag)) continue;
      } else if (CONTROLS.has(tag)) {
        this.addControl(el);
        continue;
      } else if (MEDIA.has(tag)) {
        this.addMedia(el);
        continue;
      }
      let kids: ArrayLike<Node>;
      if (tag === "slot") {
        const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
        kids = assigned.length ? assigned : el.childNodes;
      } else {
        kids = this.opts.shadowOf(el)?.childNodes ?? el.childNodes;
      }
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    for (const t of this.targets) {
      for (let e = flatParent(t.el); e; e = flatParent(e)) {
        const up = this.byEl.get(e);
        if (up) {
          up.leaf = false;
          break;
        }
      }
    }
    this.done = true;
    return true;
  }

  private addText(node: Text): void {
    const parent = flatParent(node);
    if (!parent || !this.isVisible(parent)) return;
    const blockEl = this.blockOf(parent);
    if (!blockEl) return;
    // White space between inline elements, as in "genus <i>Felis</i> diverged", belongs to the
    // text it sits in; on its own it makes no element worth selecting.
    if (!/\S/.test(node.data)) {
      this.byEl.get(blockEl)?.texts.push(node);
      return;
    }
    this.target(blockEl, "text")?.texts.push(node);
  }

  private addMedia(el: Element): void {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !this.isVisible(el)) return;
    if (r.width >= STANDALONE_W && r.height >= STANDALONE_H) {
      this.target(el, "media");
      return;
    }
    const parent = flatParent(el);
    const blockEl = parent ? this.blockOf(parent) : null;
    if (blockEl) this.target(blockEl, "text");
  }

  private addControl(el: Element): void {
    if (el.localName === "input" && (el as HTMLInputElement).type === "hidden") return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !this.isVisible(el)) return;
    // A field whose text cannot be seen is laid over other content to catch selection and the
    // caret, as GitHub does over its code; the content under it is what a person sees.
    if (el.localName !== "button" && seeThrough(getComputedStyle(el))) return;
    this.target(el, "control");
  }

  /** An element the project named: a target of its own, whatever it holds. */
  private addNamed(el: Element): void {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || !this.isVisible(el)) return;
    this.target(el, kindOf(el));
  }

  /** Text belongs to the nearest named element around it; text outside them does not count. */
  private addNamedText(node: Text): void {
    const parent = flatParent(node);
    if (!parent || !this.isVisible(parent)) return;
    for (let e: Element | null = parent; e; e = flatParent(e)) {
      const t = this.byEl.get(e);
      if (t) {
        t.texts.push(node);
        return;
      }
      if (e === this.opts.root) return;
    }
  }

  private target(el: Element, kind: TargetKind): Target | null {
    const have = this.byEl.get(el);
    if (have) return have;
    if (kind === "text") {
      // A box with no size is hidden on purpose, such as text for screen readers only.
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return null;
    }
    const t: Target = { el, kind, order: this.targets.length, leaf: true, texts: [] };
    this.targets.push(t);
    this.byEl.set(el, t);
    return t;
  }

  /** The innermost flat-tree ancestor that lays out lines: anything whose display is not inline. */
  private blockOf(el: Element): Element | null {
    const path: Element[] = [];
    let found: Element | null = null;
    for (let e: Element | null = el; e; e = flatParent(e)) {
      const known = this.nearest.get(e);
      if (known !== undefined) {
        found = known;
        break;
      }
      path.push(e);
      const d = getComputedStyle(e).display;
      if (d !== "contents" && !d.startsWith("inline") && !d.startsWith("ruby")) {
        found = e;
        break;
      }
      if (e === this.opts.root) break;
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
}

/** True when a style draws text with no colour at all. */
function seeThrough(cs: CSSStyleDeclaration): boolean {
  const clear = (c: string) => c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  return clear(cs.color) || clear(cs.webkitTextFillColor);
}

/** What kind of thing an element is, from its tag alone. */
export function kindOf(el: Element): TargetKind {
  const tag = el.localName;
  return CONTROLS.has(tag) ? "control" : MEDIA.has(tag) ? "media" : "text";
}

/** Tags whose content is never shown as text. */
export const HIDDEN_TAGS = SKIP;

/** The text of a target, for copying: its own text for a box that holds others, else all of it. */
export function targetText(t: Target): string {
  const el = t.el;
  if (t.kind === "media") {
    const label = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") ||
      (el.localName === "svg" ? el.querySelector("title")?.textContent : "") || "";
    const kind = el.localName === "video" ? "video" : el.localName === "iframe" ? "frame" : "picture";
    return label.trim() ? `[${kind}: ${label.trim()}]` : `[${kind}]`;
  }
  if (t.kind === "control") {
    const c = el as HTMLInputElement;
    const label = el.localName === "button" ? el.textContent : c.value || c.placeholder || el.getAttribute("aria-label");
    return `[${el.localName === "button" ? "button" : "field"}: ${(label ?? "").trim()}]`;
  }
  const own = t.leaf ? (el as HTMLElement).innerText ?? el.textContent ?? "" : t.texts.map((n) => n.data).join(" ");
  return own.replace(/[ \t\f\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

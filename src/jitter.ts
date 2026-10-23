// Letters that jitter: the selected text is drawn again, letter by letter, on a canvas over the
// page, and each letter is nudged and turned a little, ten times a second, like a hand-drawn
// animation. The page's own text stays where it is with only its fill made see-through, so
// nothing moves or wraps again, and the page's elements are left as they are. When the system
// asks for less motion, the letters keep one jittered pose and do not move.

import type { Point } from "./geometry.js";

/** A selected element whose letters jitter. */
export interface JitterSource {
  el: Element;
  texts: Text[];
  /** Inside a fixed or sticky box: it stays on the screen when the page scrolls. */
  fixed: boolean;
  /** On a fixed bar such as a site header: not hidden under the bars. */
  bar: boolean;
}

interface Glyph {
  ch: string;
  /** The letter's box in viewport coordinates when it was measured, and its baseline. */
  x: number;
  y: number;
  w: number;
  h: number;
  base: number;
  size: number;
}

/** The letters of one element that share a style. */
interface Run {
  font: string;
  color: string;
  /** The font's height above the baseline, its size, and its text-transform. */
  ascent: number;
  size: number;
  transform: string;
  glyphs: Glyph[];
}

interface Entry {
  src: JitterSource;
  runs: Run[];
  /** The runs by the element that sets their style. */
  styles: Map<Element, Run>;
  /** The scroll boxes around it: where its letters may show, in viewport coordinates. */
  clip: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The page's origin when it was measured, to follow the page as it scrolls. */
  at: Point;
  measured: boolean;
  /** Where measuring goes on in the next frame: a text node, a place in it, and whether a word starts there. */
  cursor: { node: number; index: number; wordStart: boolean } | null;
}

/** New letter poses each second. */
const STEPS_PER_SECOND = 10;
/** How far a letter moves and turns, as a share of its font size and in degrees. */
const NUDGE = 0.06;
const TURN = 5;
/** Time each frame may spend measuring newly selected elements, in milliseconds. */
const MEASURE_BUDGET = 6;
/** Characters measured between looks at the clock, so a very long text stops part way. */
const CHUNK = 400;

export class Jitter {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly entries = new Map<Element, Entry>();
  private readonly segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  private readonly words = new Intl.Segmenter(undefined, { granularity: "word" });
  private readonly still: MediaQueryList;
  private frame = 0;
  private step = -1;
  private drawn = false;

  constructor(
    private readonly doc: Document,
    /** The page's origin in viewport coordinates. */
    private readonly origin: () => Point,
    /** Fixed bars that cover the page, in viewport coordinates. */
    private readonly bars: () => DOMRect[],
  ) {
    this.canvas = doc.createElement("canvas");
    this.canvas.className = "jitter";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    this.still = doc.defaultView!.matchMedia("(prefers-reduced-motion: reduce)");
  }

  /** Makes exactly these elements jitter. */
  set(sources: JitterSource[]): void {
    const want = new Map(sources.map((s) => [s.el, s]));
    for (const el of [...this.entries.keys()]) if (!want.has(el)) this.entries.delete(el);
    for (const [el, src] of want) {
      const have = this.entries.get(el);
      if (have) have.src = src;
      else this.entries.set(el, { src, runs: [], styles: new Map(), clip: null, at: [0, 0], measured: false, cursor: null });
    }
    this.wake();
  }

  /** Measures every element again, after the layout changed. */
  relayout(): void {
    for (const e of this.entries.values()) restart(e);
    this.wake();
  }

  /** Measures again the elements inside a box that scrolled. */
  relayoutInside(box: Element): void {
    for (const e of this.entries.values()) if (box.contains(e.src.el)) restart(e);
    this.wake();
  }

  /** The page scrolled: fixed elements moved against it and are measured again. */
  scrolled(): void {
    for (const e of this.entries.values()) if (e.src.fixed) restart(e);
    this.drawn = false;
    this.wake();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.entries.clear();
    this.canvas.remove();
  }

  private wake(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(time: number): void {
    this.frame = 0;
    const until = performance.now() + MEASURE_BUDGET;
    for (const e of this.entries.values()) {
      if (e.measured) continue;
      if (performance.now() > until) break;
      this.measure(e, until);
      this.drawn = false;
    }
    const step = this.still.matches ? 0 : Math.floor((time / 1000) * STEPS_PER_SECOND);
    if (step !== this.step || !this.drawn) this.draw(step);
    // Keep going while letters move or wait to be measured; stop when there is nothing to show.
    const waiting = [...this.entries.values()].some((e) => !e.measured);
    if (this.entries.size && (waiting || !this.still.matches)) this.wake();
    else if (!this.entries.size) this.clearCanvas();
  }

  /**
   * Finds where each letter of an element shows, in its own font and colour. It stops when the
   * frame's time runs out and goes on in the next frame, so a very long text never stalls one.
   */
  private measure(e: Entry, until: number): void {
    if (!e.cursor) {
      e.at = this.origin();
      e.runs = [];
      e.styles = new Map();
      e.clip = clipOf(e.src.el);
      e.cursor = { node: 0, index: 0, wordStart: true };
    }
    const c = e.cursor;
    const texts = e.src.texts;
    const range = this.doc.createRange();
    for (; c.node < texts.length; c.node++, c.index = 0, c.wordStart = true) {
      const node = texts[c.node]!;
      const parent = node.parentElement;
      if (!parent || !node.isConnected) continue;
      const run = this.runFor(e, parent);
      while (c.index < node.length) {
        if (performance.now() > until) return;
        const end = Math.min(node.length, c.index + CHUNK);
        // Letters of scripts that join, such as Arabic, change shape with their neighbours: drawn
        // one by one they would come apart, so these move a word at a time.
        const units = JOINING.test(node.data) ? this.words : this.segmenter;
        const segments = [...units.segment(node.data.slice(c.index, end))];
        // The slice may cut the last letter in two; it is measured with the next piece.
        const whole = end < node.length && segments.length > 1 ? segments.slice(0, -1) : segments;
        let done = 0;
        let count = 0;
        for (const g of whole) {
          // Text where every letter is measured, as Japanese is, looks at the clock more often.
          if (++count % 32 === 0 && performance.now() > until) {
            c.index += g.index;
            return;
          }
          done = g.index + g.segment.length;
          if (!/\S/.test(g.segment)) {
            c.wordStart = true;
            continue;
          }
          const at = c.index + g.index;
          range.setStart(node, at);
          range.setEnd(node, at + g.segment.length);
          const r = range.getClientRects()[0];
          if (r && r.width > 0 && r.height > 0) {
            run.glyphs.push({ ch: transformed(g.segment, run.transform, c.wordStart), x: r.left, y: r.top, w: r.width, h: r.height, base: r.top + run.ascent, size: run.size });
          }
          c.wordStart = !/[\p{L}\p{N}]/u.test(g.segment);
        }
        c.index += done || end - c.index;
      }
    }
    e.measured = true;
    e.cursor = null;
  }

  /** The run for the letters whose style an element sets. */
  private runFor(e: Entry, parent: Element): Run {
    let run = e.styles.get(parent);
    if (run) return run;
    const cs = getComputedStyle(parent);
    const font = canvasFont(cs);
    this.ctx.font = font;
    run = { font, color: cs.color, ascent: this.ctx.measureText("Hg").fontBoundingBoxAscent, size: parseFloat(cs.fontSize) || 16, transform: cs.textTransform, glyphs: [] };
    e.styles.set(parent, run);
    e.runs.push(run);
    return run;
  }

  private clearCanvas(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(step: number): void {
    this.step = step;
    this.drawn = true;
    const view = this.doc.defaultView!;
    const dpr = view.devicePixelRatio || 1;
    const vw = this.doc.documentElement.clientWidth, vh = this.doc.documentElement.clientHeight;
    const cw = Math.round(vw * dpr), ch = Math.round(vh * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const [ox, oy] = this.origin();
    const bars = this.bars();
    let n = 0;
    for (const e of this.entries.values()) {
      if (!e.measured) continue;
      // Page text moves with the page; fixed text was measured where it is now.
      const dx = e.src.fixed ? 0 : ox - e.at[0], dy = e.src.fixed ? 0 : oy - e.at[1];
      ctx.save();
      ctx.beginPath();
      if (e.clip) ctx.rect(e.clip.x0 + dx, e.clip.y0 + dy, e.clip.x1 - e.clip.x0, e.clip.y1 - e.clip.y0);
      else ctx.rect(0, 0, vw, vh);
      // Text under a fixed bar is hidden by the bar, so its letters are too.
      if (!e.src.bar) for (const b of bars) ctx.rect(b.right, b.top, -b.width, b.height);
      ctx.clip("evenodd");
      for (const run of e.runs) {
        ctx.font = run.font;
        ctx.fillStyle = run.color;
        for (const g of run.glyphs) {
          n++;
          const x = g.x + dx, y = g.y + dy;
          if (x > vw || x + g.w < 0 || y > vh || y + g.h < 0) continue;
          const cx = x + g.w / 2, cy = y + g.h / 2;
          const k = g.size * NUDGE;
          // One matrix for each letter, scaled for the screen, moved and turned about its middle.
          // A whole word turns less than a letter, so its ends do not swing far.
          const a = ((noise(n, step, 3) - 0.5) * 2 * TURN * Math.min(1, (g.size * 0.8) / g.w) * Math.PI) / 180;
          const cos = Math.cos(a) * dpr, sin = Math.sin(a) * dpr;
          const tx = cx + (noise(n, step, 1) - 0.5) * 2 * k, ty = cy + (noise(n, step, 2) - 0.5) * 2 * k;
          ctx.setTransform(cos, sin, -sin, cos, tx * dpr, ty * dpr);
          ctx.fillText(g.ch, -g.w / 2, g.base + dy - cy);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.restore();
    }
  }
}

/** Starts measuring an element again from its first letter. */
function restart(e: Entry): void {
  e.measured = false;
  e.cursor = null;
}

/** The canvas font for a computed style: style, small caps, weight, size and family. */
function canvasFont(cs: CSSStyleDeclaration): string {
  const caps = cs.fontVariantCaps === "small-caps" ? "small-caps " : "";
  return `${cs.fontStyle} ${caps}${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

/** A letter as CSS text-transform shows it. */
function transformed(s: string, transform: string, wordStart: boolean): string {
  if (transform === "uppercase") return s.toUpperCase();
  if (transform === "lowercase") return s.toLowerCase();
  if (transform === "capitalize" && wordStart) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Scripts whose letters join or combine, so a letter on its own does not look as it does in a word. */
const JOINING = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Mandaic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u;

/** The part of the viewport an element can show through the scroll boxes around it. */
function clipOf(el: Element): Entry["clip"] {
  let clip: Entry["clip"] = null;
  const doc = el.ownerDocument;
  for (let e = el.parentElement; e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    const cx = cs.overflowX !== "visible", cy = cs.overflowY !== "visible";
    if (!cx && !cy) continue;
    const r = e.getBoundingClientRect();
    const box = {
      x0: cx ? r.left + e.clientLeft : -1e7,
      y0: cy ? r.top + e.clientTop : -1e7,
      x1: cx ? r.left + e.clientLeft + e.clientWidth : 1e7,
      y1: cy ? r.top + e.clientTop + e.clientHeight : 1e7,
    };
    clip = clip ? { x0: Math.max(clip.x0, box.x0), y0: Math.max(clip.y0, box.y0), x1: Math.min(clip.x1, box.x1), y1: Math.min(clip.y1, box.y1) } : box;
  }
  return clip;
}

/** The same small random number for the same letter, step and use, so a redraw repeats a pose. */
function noise(i: number, step: number, k: number): number {
  let h = Math.imul(i ^ Math.imul(step + 1, 0x9e3779b1) ^ Math.imul(k, 0x85ebca6b), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

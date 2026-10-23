// The brush. While it is on, the page is a canvas: dragging paints, and every element the paint
// covers is selected and, by default, its letters jitter. Hovering shows which elements
// the brush is over. Strokes made one after another form one mark; when the user gives a mark a
// note, the next stroke starts a new mark, so each note belongs to the paint it was written for. Alt erases; an element whose paint is all erased is no longer selected. A right-click
// on a stroke takes that whole stroke away; during a drag it cancels the stroke in progress, as
// Escape does. The paint and the selection stay when the brush is put away, so they can be used.
//
// Paint lives on one of two layers. Most paint is on the page layer, which scrolls with the
// page and is hidden where a fixed bar, such as a site header, covers the page. Paint that
// starts on such a bar goes on the screen layer and stays on the bar.

import { deepElementAt, flatParent, openShadow, type ShadowOf } from "./dom.js";
import { intersectRect, segmentBounds, strokeTouchesRect, unionRect, type Point, type Rect } from "./geometry.js";
import { Jitter, type JitterSource } from "./jitter.js";
import { Looks, paintsBox, type LookKind } from "./look.js";
import { PaintLayer, type Stroke as PaintStroke } from "./paint.js";
import { css, PAINT_COLOR } from "./styles.js";
import { TargetFinder, targetText, type FindOptions, type Target, type TargetKind } from "./targets.js";

export interface BrushOptions {
  /** Where to select. The default is the page body. */
  root?: Element;
  /**
   * Which elements count. By default the brush finds them: paragraphs, headings, list items,
   * table cells, pictures, buttons and fields. A CSS selector or a test names them instead;
   * each named element is then selected as a whole, with the text inside it.
   */
  targets?: string | ((el: Element) => boolean);
  /** Leaves elements, and everything inside them, out of the selection. */
  exclude?: (el: Element) => boolean;
  /** How to reach shadow roots. An extension can pass `chrome.dom.openOrClosedShadowRoot`. */
  shadowRoot?: ShadowOf;
  /** Brush radius in CSS pixels. */
  size?: number;
  /** The paint colour, as any CSS colour. */
  color?: string;
  /**
   * How selected elements look: "default" makes the letters of text jitter and pins pictures and
   * code like photos; "none" leaves them as they are, so a project can show the selection its own way.
   */
  look?: "default" | "none";
  /** Shows the status line at the bottom of the screen while the brush is on. Default true. */
  hud?: boolean;
  zIndex?: number;
}

export interface BrushEvents {
  /** The selected elements changed. */
  change: Element[];
  /** A stroke began. */
  start: { erase: boolean };
  /**
   * A stroke ended; a cancelled stroke left no paint. `mark` is the mark it belongs to, and
   * `point` where it ended, in viewport coordinates, for placing a note box beside it.
   */
  end: { erase: boolean; cancelled: boolean; mark: number; point: [x: number, y: number] };
  /** The marks changed: one was added, taken away or given a note. */
  marks: Mark[];
  enabled: boolean;
}

/** A place the user marked: the strokes made before a note, and the note. */
export interface Mark {
  /** Stays the same for the life of the brush. */
  id: number;
  /** Its number as shown, from 1, in the order the marks were made. */
  n: number;
  /** What the user wrote or said about it; empty when there is none. */
  note: string;
  /** The box around its paint, in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number };
}

/** One mark on one selected element: the words and the area that mark's paint covers there. */
export interface ItemMark {
  id: number;
  n: number;
  note: string;
  ranges: Range[];
  area: PaintArea;
}

/** A selected element, with what the paint covers in it. */
export interface SelectedItem {
  element: Element;
  kind: TargetKind;
  /**
   * The text nodes that belong to the element, in reading order. A box that holds other
   * elements the brush can select owns only the text outside them.
   */
  textNodes: Text[];
  /** The painted words, as ranges in reading order. Empty when no word is painted, as for a picture. */
  ranges: Range[];
  /** Where the paint lies on the element. */
  area: PaintArea;
  /** The marks whose paint lies on the element, each with its own words and area. */
  marks: ItemMark[];
}

/** Where the paint lies on an element, measured on the element as laid out, without its tilt. */
export interface PaintArea {
  /** The element's size in CSS pixels. */
  width: number;
  height: number;
  /** The box around the paint, from 0 to 1 of the element's width and height; null when none shows. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The share of the element that paint covers, from 0 to 1. */
  coverage: number;
  /** The strokes over the element, oldest first, in CSS pixels from its top left corner. */
  strokes: PaintMark[];
}

export interface PaintMark {
  /** An erasing stroke takes paint away. */
  erase: boolean;
  /** In CSS pixels. */
  radius: number;
  points: [x: number, y: number][];
}

export interface Brush {
  readonly enabled: boolean;
  /** The selected elements, in reading order. */
  readonly selected: Element[];
  /** Brush radius in CSS pixels, from 4 to 60. */
  size: number;
  enable(): void;
  disable(): void;
  toggle(): void;
  destroy(): void;
  undo(): void;
  redo(): void;
  /** Removes all paint, and with it the selection. */
  clear(): void;
  /** The text of the selected elements, one element per paragraph. */
  text(): string;
  /** The selected elements in reading order, each with the words and the area its paint covers. */
  items(): SelectedItem[];
  /** The places the user marked, in the order they were made. */
  marks(): Mark[];
  /**
   * Runs `fn` with the page as it is without the brush: no paint, no marks and no look. For
   * taking a screenshot of the tab, such as for a picture whose pixels the page may not read.
   */
  unmarked<T>(fn: () => T | Promise<T>): Promise<T>;
  /**
   * Gives a mark its note, or takes the note away when it is empty. A note on the mark being
   * painted ends that mark, so the next stroke starts a new one.
   */
  note(mark: number, text: string): void;
  on<K extends keyof BrushEvents>(type: K, fn: (value: BrushEvents[K]) => void): () => void;
}

const MIN_SIZE = 4;
const MAX_SIZE = 60;
const HOST_TAG = "web-selection-brush";
/** Outlines sit this far outside an element, so they never touch its text. */
const PAD = 3;
const NS = "http://www.w3.org/2000/svg";
/** A word counts as painted when paint covers this share of the middle half of its line. */
const WORD_COVERED = 0.4;
/** The largest side of the small canvas that measures the paint on one element. */
const AREA_SIZE = 200;
/** The size of a cell of the grid that says which targets lie near a place, in CSS pixels. */
const CELL = 256;
/** How far a target may have moved since the grid was made and still be found, in CSS pixels. */
const GRID_SLACK = 64;
/** How long the first walk for targets may take before the rest goes on in idle time, in ms. */
const FIRST_WALK = 40;
/** A page with this many targets or more waits for its grid rather than look at every target. */
const BIG_PAGE = 1500;

type Layer = "page" | "screen";
type Stroke = {
  layer: Layer;
  erase: boolean;
  last: Point;
  paint: PaintStroke;
  /** The selection before the stroke, for when it is cancelled. */
  before: Set<Element>;
};
/** One step that undo can take back: a stroke added, a stroke taken away, or everything cleared. */
type Action =
  | { kind: "add"; layer: Layer; stroke: PaintStroke }
  | { kind: "remove"; layer: Layer; stroke: PaintStroke; index: number }
  | { kind: "clear"; page: PaintStroke[]; screen: PaintStroke[] };
type Overlay = { near: SVGPathElement; badges: SVGGElement; svg: SVGSVGElement };
/** A mark as the brush keeps it: its layer, and the box around its paint in that layer. */
type MarkState = { id: number; n: number; layer: Layer; box: Rect };

export function createBrush(options: BrushOptions = {}): Brush {
  return new BrushController(options);
}

class BrushController implements Brush {
  private readonly doc: Document;
  private readonly root: Element;
  private readonly shadowOf: ShadowOf;
  private readonly exclude: (el: Element) => boolean;
  private readonly only: ((el: Element) => boolean) | undefined;
  private readonly showLook: boolean;
  private readonly showHud: boolean;
  private readonly host: HTMLElement;
  private readonly glass: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly hudCount: HTMLSpanElement;
  private readonly pageEl: HTMLDivElement;
  private readonly layers: Record<Layer, PaintLayer>;
  private readonly overlays: Record<Layer, Overlay>;
  private readonly listeners = new Map<keyof BrushEvents, Set<(v: never) => void>>();
  private readonly cleanups: (() => void)[] = [];

  private on_ = false;
  private destroyed = false;
  private radius: number;
  /** The look on selected elements: pinned pictures and code, and the letters that jitter. */
  private readonly looks: Looks;
  private readonly jitter: Jitter;
  private refitTimer = 0;
  private targets: Target[] = [];
  private byEl = new Map<Element, Target>();
  private dirty = true;
  private readonly rects = new Map<Target, Rect[]>();
  private readonly clips = new Map<Element, Rect | null>();
  private readonly picks = new Set<Element>();
  private near: Target[] = [];
  private history: Action[] = [];
  private future: Action[] = [];
  private stroke: Stroke | null = null;
  /** The mark new strokes join, the next one to start, the notes, and the marks with paint. */
  private mark = 1;
  private nextMark = 2;
  private readonly notes = new Map<number, string>();
  private markList: MarkState[] = [];
  private pointer: Point | null = null;
  private alt = false;
  /** Fixed bars that cover the page, such as a site header, and the targets inside them. */
  private bars: Element[] = [];
  private onBar = new Set<Target>();
  /** Targets inside fixed or sticky boxes: they move against the page when it scrolls. */
  private pinned = new Set<Target>();
  private frame = 0;
  private autoFrame = 0;
  private autoSpeed = 0;
  private rebuildTimer = 0;
  private barsTimer = 0;
  /**
   * Where the targets lie on the page, by cell, so a stroke looks only at the targets near it.
   * Targets in fixed or sticky boxes move against the page, so they are kept apart and always
   * looked at. Both the walk for targets and the grid are made in idle time, a part at a time.
   */
  private grid: Map<string, Element[]> | null = null;
  private loose: Target[] = [];
  private finder: TargetFinder | null = null;
  private gridQueue: Target[] | null = null;
  private gridNext: Map<string, Element[]> | null = null;
  private gridTimer = 0;
  private stopIdle: (() => void) | null = null;
  /** The pointer moved: work out what it is over in the next frame. */
  private hoverDue = false;
  /** The grid changed during a stroke: work out the selection from the paint when it ends. */
  private repickDue = false;
  /** The selection changed during a stroke: give it its look in the next frame. */
  private looksDue = false;

  constructor(options: BrushOptions) {
    this.doc = options.root?.ownerDocument ?? document;
    this.root = options.root ?? this.doc.body;
    this.shadowOf = options.shadowRoot ?? openShadow;
    this.radius = clamp(options.size ?? 16, MIN_SIZE, MAX_SIZE);
    const named = options.targets;
    this.only = typeof named === "string" ? (el) => el.matches(named) : named;
    this.showLook = options.look !== "none";
    this.showHud = options.hud !== false;
    const color = options.color ?? PAINT_COLOR;
    const doc = this.doc;
    this.looks = new Looks(doc);
    this.jitter = new Jitter(doc, () => this.origin(), () => this.bars.map((b) => b.getBoundingClientRect()));

    this.host = doc.createElement(HOST_TAG);
    this.host.setAttribute("style", hostStyle(options.zIndex ?? 2147483646, options.color));
    const host = this.host;
    this.exclude = (el) => el === host || (options.exclude ? options.exclude(el) : false);
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = css;
    const div = (cls: string) => {
      const d = doc.createElement("div");
      d.className = cls;
      return d;
    };
    const overlay = (cls: string): Overlay => {
      const svg = doc.createElementNS(NS, "svg");
      svg.setAttribute("class", cls);
      svg.setAttribute("width", "1");
      svg.setAttribute("height", "1");
      svg.setAttribute("aria-hidden", "true");
      const near = doc.createElementNS(NS, "path");
      near.setAttribute("class", "near");
      const badges = doc.createElementNS(NS, "g");
      badges.setAttribute("class", "badges");
      svg.append(near, badges);
      return { svg, near, badges };
    };
    this.pageEl = div("paint");
    const screenEl = div("screen-paint");
    this.overlays = { page: overlay("marks"), screen: overlay("screen-marks") };
    this.glass = div("glass");
    this.glass.hidden = true;
    this.hud = div("hud");
    this.hud.hidden = true;
    this.hud.setAttribute("role", "status");
    const dot = doc.createElement("span");
    dot.className = "dot";
    this.hudCount = doc.createElement("span");
    this.hudCount.className = "count";
    const keys = doc.createElement("span");
    keys.className = "keys";
    keys.textContent = "Alt erases · Right-click removes a stroke · [ ] size · Esc done";
    this.hud.append(dot, this.hudCount, keys);
    // The jittering letters sit under the paint, as the page's own letters do.
    shadow.append(style, this.jitter.canvas, this.pageEl, this.overlays.page.svg, screenEl, this.overlays.screen.svg, this.glass, this.hud);
    this.layers = { page: new PaintLayer(this.pageEl, color), screen: new PaintLayer(screenEl, color) };
    this.bind();
  }

  /* ---------- public ---------- */

  get enabled(): boolean {
    return this.on_;
  }

  get selected(): Element[] {
    return this.pickedTargets().map((t) => t.el);
  }

  get size(): number {
    return this.radius;
  }

  set size(v: number) {
    const r = clamp(Math.round(v), MIN_SIZE, MAX_SIZE);
    if (r === this.radius) return;
    this.radius = r;
    this.refreshCursor();
    if (this.pointer && !this.stroke) this.hover();
  }

  enable(): void {
    if (this.destroyed || this.on_) return;
    this.on_ = true;
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
    this.fitHost();
    this.glass.hidden = false;
    this.hud.hidden = !this.showHud;
    // Keys go to the brush, not to a field on the page that had focus.
    const active = this.doc.activeElement as HTMLElement | null;
    if (active && active !== this.doc.body && isEditable(active)) active.blur();
    for (const l of Object.values(this.layers)) l.refresh();
    this.host.toggleAttribute("data-dark-page", isDarkPage(this.doc));
    if (this.dirty && !this.finder) this.walk(FIRST_WALK);
    this.findBars();
    this.refreshCursor();
    this.updateHud();
    this.emit("enabled", true);
    this.schedule();
  }

  disable(): void {
    if (!this.on_) return;
    this.on_ = false;
    this.finishStroke();
    this.glass.hidden = true;
    this.hud.hidden = true;
    this.near = [];
    if (this.layers.page.isEmpty && this.layers.screen.isEmpty && !this.looks.size) this.host.remove();
    this.emit("enabled", false);
    this.schedule();
  }

  toggle(): void {
    if (this.on_) this.disable();
    else this.enable();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.disable();
    this.destroyed = true;
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.autoFrame);
    clearTimeout(this.rebuildTimer);
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(this.barsTimer);
    clearTimeout(this.barsTimer);
    clearTimeout(this.refitTimer);
    clearTimeout(this.gridTimer);
    this.stopIdle?.();
    this.picks.clear();
    this.applyLooks();
    this.jitter.destroy();
    this.host.remove();
    this.listeners.clear();
  }

  undo(): void {
    const a = this.history.pop();
    if (!a) return;
    this.apply(a, true);
    this.future.push(a);
    this.repick();
  }

  redo(): void {
    const a = this.future.pop();
    if (!a) return;
    this.apply(a, false);
    this.history.push(a);
    this.repick();
  }

  clear(): void {
    const page = this.layers.page.all();
    const screen = this.layers.screen.all();
    if (!page.length && !screen.length) return;
    this.layers.page.replaceAll([]);
    this.layers.screen.replaceAll([]);
    this.record({ kind: "clear", page, screen });
    this.repick();
  }

  private record(a: Action): void {
    this.history.push(a);
    this.future = [];
  }

  /** Does an action, or takes it back. */
  private apply(a: Action, back: boolean): void {
    if (a.kind === "clear") {
      this.layers.page.replaceAll(back ? a.page : []);
      this.layers.screen.replaceAll(back ? a.screen : []);
    } else if ((a.kind === "add") === back) {
      this.layers[a.layer].remove(a.stroke);
    } else {
      const at = a.kind === "remove" ? a.index : Number.MAX_SAFE_INTEGER;
      this.layers[a.layer].insert(a.stroke, at);
    }
  }

  /** Takes away the whole stroke under a point, the newest one first. */
  private removeStrokeAt(client: Point): void {
    const [ox, oy] = this.origin();
    for (const layer of ["screen", "page"] as const) {
      const p: Point = layer === "page" ? [client[0] - ox, client[1] - oy] : client;
      const stroke = this.layers[layer].strokeAt(p);
      if (!stroke) continue;
      const index = this.layers[layer].remove(stroke);
      this.record({ kind: "remove", layer, stroke, index });
      this.repick();
      return;
    }
  }

  text(): string {
    this.settle();
    return this.pickedTargets().map(targetText).filter(Boolean).join("\n\n");
  }

  async unmarked<T>(fn: () => T | Promise<T>): Promise<T> {
    const host = this.host.style;
    const before = host.getPropertyValue("visibility");
    host.setProperty("visibility", "hidden", "important");
    const undo = this.looks.suspend();
    try {
      // Let the page be drawn without the brush before anything looks at it.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return await fn();
    } finally {
      undo();
      if (before) host.setProperty("visibility", before);
      else host.removeProperty("visibility");
    }
  }

  /**
   * Finishes a walk for targets or a grid still in progress, so an answer about the selection is
   * complete. It costs time only when called while one runs, as right after a big page changed.
   */
  private settle(): void {
    if (this.stroke) return;
    // The page changed and the next walk has not begun: walk now.
    if (this.dirty && !this.finder) this.finder = new TargetFinder(this.findOptions());
    if (this.finder) {
      this.finder.step(Infinity);
      this.useTargets(this.finder);
    }
    if (this.gridQueue && !this.finder) this.gridStep(Infinity);
  }

  items(): SelectedItem[] {
    this.settle();
    const picked = this.pickedTargets();
    const marks = this.markList;
    // Areas are measured as laid out, without the tilt of pinned pictures.
    const ranges = picked.map((t) => this.paintedWords(t, (band) => this.layers[this.layerOf(t)].coverage(band)));
    const own = (id: number) => (s: PaintStroke) => s.erase || s.mark === id;
    const areas = this.looks.unpinned(() =>
      picked.map((t) => ({ all: this.areaOf(t, () => true), each: marks.length > 1 ? marks.map((m) => this.areaOf(t, own(m.id))) : [] })),
    );
    return picked.map((t, i) => {
      const area = areas[i]!.all;
      let itemMarks: ItemMark[];
      if (marks.length > 1) {
        itemMarks = [];
        marks.forEach((m, k) => {
          const a = areas[i]!.each[k]!;
          if (!a.box) return;
          const words = this.paintedWords(t, this.markCoverage(t, own(m.id)));
          itemMarks.push({ id: m.id, n: m.n, note: this.notes.get(m.id) ?? "", ranges: words, area: a });
        });
      } else {
        const m = marks[0];
        itemMarks = m ? [{ id: m.id, n: m.n, note: this.notes.get(m.id) ?? "", ranges: ranges[i]!, area }] : [];
      }
      return { element: t.el, kind: t.kind, textNodes: [...t.texts], ranges: ranges[i]!, area, marks: itemMarks };
    });
  }

  marks(): Mark[] {
    const [ox, oy] = this.origin();
    return this.markList.map((m) => {
      const dx = m.layer === "page" ? ox : 0, dy = m.layer === "page" ? oy : 0;
      return { id: m.id, n: m.n, note: this.notes.get(m.id) ?? "", rect: { x: m.box.x0 + dx, y: m.box.y0 + dy, width: m.box.x1 - m.box.x0, height: m.box.y1 - m.box.y0 } };
    });
  }

  note(mark: number, text: string): void {
    const t = text.trim();
    if ((this.notes.get(mark) ?? "") === t) return;
    if (t) this.notes.set(mark, t);
    else this.notes.delete(mark);
    if (t && mark === this.mark) this.mark = this.nextMark++;
    this.emit("marks", this.marks());
    this.schedule();
  }

  /**
   * Finds the marks that still show paint and numbers them in the order they were made. A mark
   * whose paint was all erased, undone or cleared is gone.
   */
  private refreshMarks(): void {
    const found = new Map<number, { layer: Layer; box: Rect }>();
    for (const layer of ["page", "screen"] as const) {
      const all = this.layers[layer].all();
      const ids = new Set(all.filter((s) => !s.erase).map((s) => s.mark));
      for (const id of ids) {
        if (found.has(id)) continue;
        const box = paintBox(this.doc, all.filter((s) => s.erase || s.mark === id));
        if (box) found.set(id, { layer, box });
      }
    }
    const list = [...found].sort((a, b) => a[0] - b[0]).map(([id, v], i) => ({ id, n: i + 1, ...v }));
    const same = list.length === this.markList.length && list.every((m, i) => m.id === this.markList[i]!.id && m.n === this.markList[i]!.n);
    this.markList = list;
    if (!same) this.emit("marks", this.marks());
    this.schedule();
  }

  /** How much of a band, in layer coordinates, one mark's paint covers on a target. */
  private markCoverage(t: Target, keep: (s: PaintStroke) => boolean): (band: Rect) => number {
    const layer = this.layerOf(t);
    const [ox, oy] = this.origin();
    const r = t.el.getBoundingClientRect();
    const dx = layer === "page" ? ox : 0, dy = layer === "page" ? oy : 0;
    const region = { x0: r.left - dx - 2, y0: r.top - dy - 2, x1: r.right - dx + 2, y1: r.bottom - dy + 2 };
    const raster = rasterize(this.doc, this.layers[layer].all().filter(keep), region, 0.5);
    return (band) => raster.coverage(band);
  }

  on<K extends keyof BrushEvents>(type: K, fn: (value: BrushEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set!.delete(fn as (v: never) => void);
  }

  /* ---------- selection ---------- */

  private emit<K extends keyof BrushEvents>(type: K, value: BrushEvents[K]): void {
    for (const fn of this.listeners.get(type) ?? []) {
      try {
        (fn as (v: BrushEvents[K]) => void)(value);
      } catch (err) {
        console.error("[web-selection] listener failed", err);
      }
    }
  }

  private pickedTargets(): Target[] {
    const out: Target[] = [];
    for (const el of this.picks) {
      const t = this.byEl.get(el);
      if (t && el.isConnected) out.push(t);
    }
    return out.sort((a, b) => a.order - b.order);
  }

  private changed(): void {
    // While a stroke is painted, the look follows once a frame rather than on every move.
    if (this.stroke) this.looksDue = true;
    else this.applyLooks();
    this.updateHud();
    this.emit("change", this.selected);
    this.schedule();
  }

  private findOptions(): FindOptions {
    return { root: this.root, exclude: this.exclude, shadowOf: this.shadowOf, only: this.only };
  }

  /**
   * Walks the page for targets: for up to `budget` ms at once, then on in idle time. Until the
   * walk is done, the brush works with the targets it has.
   */
  private walk(budget = 0): void {
    this.finder = new TargetFinder(this.findOptions());
    if (budget && this.finder.step(performance.now() + budget)) this.useTargets(this.finder);
    else this.idle();
  }

  /** Runs the walk for targets, then the grid, a part at a time while the browser is idle. */
  private idle(): void {
    if (this.stopIdle || this.destroyed) return;
    const win = this.doc.defaultView!;
    const run = (until: number) => {
      this.stopIdle = null;
      // A stroke keeps the targets it began with; the walk goes on once it ends.
      if (this.finder && !this.stroke && this.finder.step(until)) this.useTargets(this.finder);
      else if (!this.finder && this.gridQueue) this.gridStep(until);
      if (this.finder || this.gridQueue) this.idle();
    };
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback((d) => run(performance.now() + Math.max(4, d.timeRemaining())), { timeout: 120 });
      this.stopIdle = () => win.cancelIdleCallback(id);
    } else {
      const id = win.setTimeout(() => run(performance.now() + 8), 16);
      this.stopIdle = () => win.clearTimeout(id);
    }
  }

  /** Takes the targets a walk found, then makes the grid again and the selection from the paint. */
  private useTargets(finder: TargetFinder): void {
    this.finder = null;
    this.targets = finder.targets;
    this.byEl = new Map(this.targets.map((t) => [t.el, t]));
    this.rects.clear();
    this.clips.clear();
    this.dirty = false;
    const pins = new Map<Element, boolean>();
    const isPinned = (el: Element): boolean => {
      let v = pins.get(el);
      if (v === undefined) {
        const pos = getComputedStyle(el).position;
        const up = flatParent(el);
        v = pos === "fixed" || pos === "sticky" || (up ? isPinned(up) : false);
        pins.set(el, v);
      }
      return v;
    };
    this.pinned = new Set(this.targets.filter((t) => isPinned(t.el)));
    this.loose = this.targets.filter((t) => this.pinned.has(t));
    this.sortBars();
    for (const el of [...this.picks]) if (!el.isConnected) this.picks.delete(el);
    this.regrid();
  }

  /** Makes the grid again, in idle time; until it is done, the old one still points the way. */
  private regrid(): void {
    clearTimeout(this.gridTimer);
    this.gridQueue = this.targets.filter((t) => !this.pinned.has(t));
    this.gridNext = new Map();
    this.idle();
  }

  /** Measures some more targets into the new grid; once all are in, the grid is used. */
  private gridStep(until: number): void {
    const queue = this.gridQueue!, grid = this.gridNext!;
    let count = 0;
    while (queue.length) {
      if (++count % 64 === 0 && performance.now() > until) return;
      const t = queue.pop()!;
      const b = boundsOf(this.rectsOf(t));
      if (!b) continue;
      for (const key of cellsOf(b)) {
        const cell = grid.get(key);
        if (cell) cell.push(t.el);
        else grid.set(key, [t.el]);
      }
    }
    this.grid = grid;
    this.gridQueue = this.gridNext = null;
    // Paint laid while the grid was being made may have missed new targets: look again, once
    // any stroke being painted has ended.
    if (!this.layers.page.isEmpty || !this.layers.screen.isEmpty) {
      if (this.stroke) this.repickDue = true;
      else this.repick();
    }
    this.hover();
  }

  /**
   * The targets that may lie in a rectangle, in page coordinates: from the grid, and the loose
   * ones. Before the first grid is made, a small page is looked at whole; a big one waits for
   * the grid, and the selection catches up from the paint once it is made.
   */
  private *candidates(box: Rect): Iterable<Target> {
    yield* this.loose;
    const grid = this.grid;
    if (!grid) {
      if (this.targets.length < BIG_PAGE) for (const t of this.targets) if (!this.pinned.has(t)) yield t;
      return;
    }
    const seen = new Set<Element>();
    const wide = { x0: box.x0 - GRID_SLACK, y0: box.y0 - GRID_SLACK, x1: box.x1 + GRID_SLACK, y1: box.y1 + GRID_SLACK };
    for (const key of cellsOf(wide)) {
      for (const el of grid.get(key) ?? []) {
        if (seen.has(el)) continue;
        seen.add(el);
        const t = this.byEl.get(el);
        if (t && !this.pinned.has(t)) yield t;
      }
    }
  }

  private markDirty(): void {
    this.dirty = true;
    this.relayout();
    clearTimeout(this.rebuildTimer);
    if (!this.host.isConnected) return;
    this.rebuildTimer = window.setTimeout(() => {
      this.findBars();
      this.walk();
    }, 250);
  }

  private relayout(): void {
    this.rects.clear();
    this.clips.clear();
    this.jitter.relayout();
    this.regridSoon();
    this.schedule();
  }

  /** The layout changed: make the grid again once the changes settle. */
  private regridSoon(): void {
    clearTimeout(this.gridTimer);
    this.gridTimer = window.setTimeout(() => {
      if (!this.finder && this.targets.length) this.regrid();
    }, 150);
  }

  /**
   * Makes the overlay exactly as big as the page: measured with the overlay itself at no size,
   * so the page's own size is what counts.
   */
  private fitHost(): void {
    const s = this.host.style;
    s.setProperty("width", "0px", "important");
    s.setProperty("height", "0px", "important");
    const de = this.doc.documentElement;
    s.setProperty("width", `${Math.max(de.scrollWidth, de.clientWidth)}px`, "important");
    s.setProperty("height", `${Math.max(de.scrollHeight, de.clientHeight)}px`, "important");
  }

  /** Forgets where the targets inside one box are, after that box scrolled. */
  private relayoutInside(box: Element): void {
    const inside = (n: Node) => n !== box && flatContains(box, n);
    for (const t of [...this.rects.keys()]) if (inside(t.el)) this.rects.delete(t);
    for (const el of [...this.clips.keys()]) if (inside(el)) this.clips.delete(el);
    this.jitter.relayoutInside(box);
    this.regridSoon();
    this.schedule();
  }

  /** The layer a target is painted on: the screen layer for elements on a fixed bar. */
  private layerOf(t: Target): Layer {
    return this.onBar.has(t) ? "screen" : "page";
  }

  /** True when any paint of `layer` lies inside a rectangle given in page coordinates. */
  private painted(layer: Layer, r: Rect): boolean {
    if (layer === "page") return this.layers.page.paintedIn(r);
    const [ox, oy] = this.origin();
    return this.layers.screen.paintedIn({ x0: r.x0 + ox, y0: r.y0 + oy, x1: r.x1 + ox, y1: r.y1 + oy });
  }

  /** Recomputes the selection from the paint itself, after undo, redo or clear. */
  private repick(): void {
    this.picks.clear();
    const [ox, oy] = this.origin();
    const pb = this.layers.page.bounds();
    const sbv = this.layers.screen.bounds();
    const sb = sbv && { x0: sbv.x0 - ox, y0: sbv.y0 - oy, x1: sbv.x1 - ox, y1: sbv.y1 - oy };
    const around = pb ?? sb;
    for (const t of around ? this.candidates(pb && sb ? unionRect(pb, sb) : around) : []) {
      const layer = this.layerOf(t);
      const b = layer === "page" ? pb : sb;
      if (!b) continue;
      for (const r of this.rectsOf(t)) {
        const part = intersectRect(r, b);
        if (part && this.painted(layer, part)) {
          this.picks.add(t.el);
          break;
        }
      }
    }
    this.refreshMarks();
    this.changed();
  }

  /**
   * Paints or erases from `a` to `b`, given in page coordinates, and updates the selection
   * under it. A stroke only selects elements of its own layer.
   */
  private brushSegment(a: Point, b: Point, s: Stroke): void {
    const r = this.radius;
    const box = segmentBounds(a, b, r);
    let changed = false;
    for (const t of this.candidates(box)) {
      if (this.layerOf(t) !== s.layer) continue;
      const picked = this.picks.has(t.el);
      if (s.erase !== picked) continue;
      const rects = this.rectsOf(t);
      if (!rects.some((x) => strokeTouchesRect(a, b, r, x))) continue;
      if (s.erase) {
        // Still selected while any of its paint is left.
        if (!rects.some((x) => this.painted(s.layer, x))) {
          this.picks.delete(t.el);
          changed = true;
        }
      } else if (rects.some((x) => {
        const part = intersectRect(x, box);
        return part !== null && this.painted(s.layer, part);
      })) {
        this.picks.add(t.el);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /**
   * Gives every selected element the look and takes it off the rest: jittering letters for text,
   * code and buttons, and a pinned photo for pictures. The letters of code are drawn where they
   * are, so its columns stay lined up. A box that holds other elements keeps its own look, since
   * its rules would reach the elements inside it too. Fields have no letters of their own to
   * draw, so they keep theirs.
   */
  private applyLooks(): void {
    const want = new Map<Element, LookKind>();
    const letters: JitterSource[] = [];
    for (const t of this.showLook ? this.pickedTargets() : []) {
      if (t.kind === "media") {
        const box = this.visualBox(t);
        want.set(box, clippedClosely(box) ? "framed" : "pinned");
        continue;
      }
      if (!t.leaf) continue;
      // A button's label is page text; a field's value is drawn by the field itself.
      const texts = t.kind === "control" ? (t.el.localName === "button" ? textNodesIn(t.el) : []) : t.texts;
      if (!texts.length) continue;
      want.set(t.el, "jitter");
      letters.push({ el: t.el, texts, fixed: this.pinned.has(t), bar: this.onBar.has(t) });
    }
    this.looks.set(want);
    this.jitter.set(letters);
  }

  /**
   * The box a person sees as an element: the element itself, or a wrapper close around it that
   * paints its background, such as the grey box around a code block, when that wrapper holds
   * nothing else worth selecting.
   */
  private visualBox(t: Target): Element {
    let box = t.el;
    for (let e = flatParent(t.el), depth = 0; e && depth < 3 && e !== this.doc.body; e = flatParent(e), depth++) {
      const crowded = this.targets.some((o) => o !== t && flatContains(e!, o.el) && !flatContains(t.el, o.el) && worthSelecting(o));
      if (crowded) break;
      if (paintsBox(e)) box = e;
    }
    return box;
  }

  /* ---------- what the paint covers ---------- */

  /**
   * The painted words of a text element, joined into runs: a word counts when paint covers
   * enough of the middle of its line, so paint that only grazes the line above does not count.
   */
  private paintedWords(t: Target, coverage: (band: Rect) => number): Range[] {
    if (t.kind !== "text" || !t.texts.length) return [];
    const layer = this.layerOf(t);
    const [ox, oy] = this.origin();
    const words = new Intl.Segmenter(langOf(t.el), { granularity: "word" });
    const probe = this.doc.createRange();
    const covered = (r: DOMRect): boolean => {
      if (r.width <= 0 || r.height <= 0) return false;
      const dx = layer === "page" ? ox : 0, dy = layer === "page" ? oy : 0;
      return coverage({ x0: r.left - dx, y0: r.top + r.height * 0.25 - dy, x1: r.right - dx, y1: r.bottom - r.height * 0.25 - dy }) >= WORD_COVERED;
    };
    const out: Range[] = [];
    let run: Range | null = null;
    let runRoot: Node | null = null;
    for (const node of t.texts) {
      // A range cannot reach across a shadow root's edge.
      const root = node.getRootNode();
      if (run && root !== runRoot) {
        out.push(run);
        run = null;
      }
      for (const w of words.segment(node.data)) {
        if (!/\S/.test(w.segment)) continue;
        probe.setStart(node, w.index);
        probe.setEnd(node, w.index + w.segment.length);
        // Brackets and other marks count when painted, as they matter in code. Full stops,
        // commas and the like only count between painted words, so they never start or end a run.
        if (!w.isWordLike && /^\p{Po}+$/u.test(w.segment)) continue;
        const hit = [...probe.getClientRects()].some(covered);
        if (!w.isWordLike && !hit) continue;
        if (hit) {
          if (!run) {
            run = this.doc.createRange();
            run.setStart(node, w.index);
            runRoot = root;
          }
          run.setEnd(node, w.index + w.segment.length);
        } else if (run) {
          out.push(run);
          run = null;
        }
      }
    }
    if (run) out.push(run);
    return out;
  }

  /**
   * Where the paint lies on an element, in the element's own CSS pixels. Called with the tilt
   * taken off: paint laid over a tilted picture is turned back by the same angle.
   */
  private areaOf(t: Target, keep: (s: PaintStroke) => boolean): PaintArea {
    const layer = this.layerOf(t);
    const [ox, oy] = this.origin();
    const dx = layer === "page" ? ox : 0, dy = layer === "page" ? oy : 0;
    const r = t.el.getBoundingClientRect();
    const x = r.left - dx, y = r.top - dy, w = r.width, h = r.height;
    let turn = (p: Point): Point => p;
    for (let e: Element | null = t.el, depth = 0; e && depth < 5; e = flatParent(e), depth++) {
      const tilt = this.looks.tiltOf(e);
      if (!tilt) continue;
      const b = e.getBoundingClientRect();
      const cx = (b.left + b.right) / 2 - dx, cy = (b.top + b.bottom) / 2 - dy;
      const a = (-tilt * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      turn = (p) => [cx + (p[0] - cx) * cos - (p[1] - cy) * sin, cy + (p[0] - cx) * sin + (p[1] - cy) * cos];
      break;
    }
    const strokes: PaintMark[] = [];
    for (const s of this.layers[layer].all()) {
      if (!keep(s)) continue;
      const points = s.points.map((p) => {
        const q = turn(p);
        return [round1(q[0] - x), round1(q[1] - y)] as [number, number];
      });
      const near = points.some(([px, py], i) => {
        const [qx, qy] = points[Math.max(0, i - 1)]!;
        return strokeTouchesRect([qx, qy], [px, py], s.radius, { x0: 0, y0: 0, x1: w, y1: h });
      });
      if (near) strokes.push({ erase: s.erase, radius: s.radius, points });
    }
    return { width: round1(w), height: round1(h), ...this.measureArea(strokes, w, h), strokes };
  }

  /** Draws the strokes small, to find the box around the paint and the share it covers. */
  private measureArea(strokes: PaintMark[], w: number, h: number): Pick<PaintArea, "box" | "coverage"> {
    if (!strokes.some((s) => !s.erase) || w < 1 || h < 1) return { box: null, coverage: 0 };
    const k = Math.min(1, AREA_SIZE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const canvas = this.doc.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) return { box: null, coverage: 0 };
    c.scale(k, k);
    drawMarks(c, strokes, "#000");
    const data = c.getImageData(0, 0, cw, ch).data;
    let n = 0, x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let py = 0; py < ch; py++) {
      for (let px = 0; px < cw; px++) {
        if (data[(py * cw + px) * 4 + 3]! < 128) continue;
        n++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    if (!n) return { box: null, coverage: 0 };
    const f = (v: number) => Math.round(v * 1000) / 1000;
    return { box: { x0: f(x0 / cw), y0: f(y0 / ch), x1: f((x1 + 1) / cw), y1: f((y1 + 1) / ch) }, coverage: f(n / (cw * ch)) };
  }

  /* ---------- measuring ---------- */

  private origin(): Point {
    const r = this.host.getBoundingClientRect();
    return [r.left, r.top];
  }

  private local(x: number, y: number): Point {
    const o = this.origin();
    return [x - o[0], y - o[1]];
  }

  /**
   * Where an element counts as hit, in page coordinates: the lines of its text, or for a picture,
   * a field, a button or a table cell, its box. Lines, not the box, because a paragraph's box runs
   * on under a picture floated beside it, and paint on the picture is not paint on the paragraph.
   */
  private rectsOf(t: Target): Rect[] {
    let list = this.rects.get(t);
    if (list) return list;
    const [ox, oy] = this.origin();
    const toLocal = (r: DOMRectReadOnly): Rect => ({ x0: r.left - ox, y0: r.top - oy, x1: r.right - ox, y1: r.bottom - oy });
    const clip = this.clipOf(t.el);
    const raw: Rect[] = [];
    if (clip) {
      if (t.kind !== "text" || /^t[dh]$/.test(t.el.localName) || !t.texts.length) {
        const r = t.el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) raw.push(toLocal(r));
      } else {
        const range = this.doc.createRange();
        for (const n of t.texts) {
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) raw.push(toLocal(r));
        }
      }
    }
    list = raw.map((r) => (clip ? intersectRect(r, clip) : null)).filter((r): r is Rect => r !== null);
    this.rects.set(t, list);
    return list;
  }

  /** The part of the page an element can show through the scroll boxes around it; null if none. */
  private clipOf(el: Element): Rect | null {
    const have = this.clips.get(el);
    if (have !== undefined) return have;
    const parent = flatParent(el);
    let clip: Rect | null = { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 };
    if (parent && parent !== this.doc.body && parent !== this.doc.documentElement) {
      clip = this.clipOf(parent);
      if (clip) {
        const cs = getComputedStyle(parent);
        const cx = cs.overflowX !== "visible";
        const cy = cs.overflowY !== "visible";
        if (cx || cy) {
          const r = parent.getBoundingClientRect();
          const [ox, oy] = this.origin();
          const x0 = r.left + parent.clientLeft - ox;
          const y0 = r.top + parent.clientTop - oy;
          clip = intersectRect(clip, {
            x0: cx ? x0 : -1e7,
            y0: cy ? y0 : -1e7,
            x1: cx ? x0 + parent.clientWidth : 1e7,
            y1: cy ? y0 + parent.clientHeight : 1e7,
          });
        }
      }
    }
    this.clips.set(el, clip);
    return clip;
  }

  /**
   * Finds the fixed bars along the top and bottom of the screen, such as a site header or a
   * cookie bar: fixed or stuck, half the screen wide or more, and not see-through.
   */
  private findBars(): void {
    const de = this.doc.documentElement;
    const vw = de.clientWidth;
    const vh = de.clientHeight;
    const found = new Set<Element>();
    const isHost = (el: Element) => el === this.host;
    // Three points across each of four rows along the top and the bottom: a bar is at least half
    // as wide as the screen, so it covers the middle one or both of the others.
    const xs = [vw * 0.2, vw * 0.5, vw * 0.8];
    const ys = [2, 20, 56, 110, vh - 3, vh - 21, vh - 57, vh - 111];
    const positions = new Map<Element, string>();
    const position = (e: Element) => {
      let p = positions.get(e);
      if (p === undefined) positions.set(e, (p = getComputedStyle(e).position));
      return p;
    };
    for (const y of ys) {
      for (const x of xs) {
        const hit = deepElementAt(this.doc, x, y, isHost, this.shadowOf);
        if (!hit) continue;
        let bar: Element | null = null;
        for (let e: Element | null = hit; e; e = flatParent(e)) {
          const pos = position(e);
          if (pos === "fixed" || pos === "sticky") bar = e;
        }
        if (!bar || found.has(bar)) continue;
        const r = bar.getBoundingClientRect();
        if (r.width < vw * 0.5 || (r.top > 2 && r.bottom < vh - 2)) continue;
        if (opaqueBetween(hit, bar)) found.add(bar);
      }
    }
    const same = found.size === this.bars.length && this.bars.every((b) => found.has(b));
    this.bars = [...found];
    if (!same) this.sortBars();
    this.updateClip();
  }

  private sortBars(): void {
    this.onBar = new Set(this.targets.filter((t) => this.bars.some((b) => flatContains(b, t.el))));
  }

  /** Hides the page layer's paint and outlines where a fixed bar covers the page. */
  private updateClip(): void {
    const [ox, oy] = this.origin();
    let d = "";
    for (const b of this.bars) {
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const x0 = r.left - ox, y0 = r.top - oy, x1 = r.right - ox, y1 = r.bottom - oy;
      d += `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
    }
    const clip = d ? `path(evenodd, "M-1000000 -1000000H1000000V1000000H-1000000Z${d}")` : "";
    this.pageEl.style.clipPath = clip;
    this.overlays.page.svg.style.clipPath = clip;
  }

  /* ---------- input ---------- */

  private bind(): void {
    const glass = this.glass;
    const win = this.doc.defaultView!;
    const listen = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    listen<PointerEvent>(glass, "pointerdown", (e) => this.pointerDown(e));
    listen<PointerEvent>(glass, "pointermove", (e) => this.pointerMove(e));
    listen<PointerEvent>(glass, "pointerup", (e) => this.pointerUp(e));
    listen<PointerEvent>(glass, "pointercancel", () => this.finishStroke());
    listen<PointerEvent>(glass, "pointerleave", () => {
      if (this.stroke) return;
      this.pointer = null;
      this.near = [];
      this.schedule();
    });
    listen<MouseEvent>(glass, "contextmenu", (e) => e.preventDefault());
    listen<WheelEvent>(glass, "wheel", (e) => this.wheel(e), { passive: false });
    listen<KeyboardEvent>(win, "keydown", (e) => this.keyDown(e), { capture: true });
    listen<KeyboardEvent>(win, "keyup", (e) => this.keyUp(e), { capture: true });
    listen<FocusEvent>(win, "blur", () => this.setAlt(false));
    listen<ClipboardEvent>(this.doc, "copy", (e) => this.copy(e), { capture: true });
    listen<Event>(this.doc, "scroll", (e) => this.scrolled(e), { capture: true, passive: true });
    listen<Event>(win, "resize", () => {
      this.fitHost();
      for (const l of Object.values(this.layers)) l.refresh();
      this.markDirty();
      // Wider things tilt less, so work out the tilts again once the size settles.
      clearTimeout(this.refitTimer);
      this.refitTimer = window.setTimeout(() => this.looks.refit(), 200);
    });
    // A picture or a style sheet that loads can move the layout. The brush's own style sheet
    // fires "load" each time the look changes, and that moves nothing.
    listen<Event>(this.doc, "load", (e) => {
      const t = e.target;
      if (t instanceof Element && t.hasAttribute("data-web-selection")) return;
      this.relayout();
    }, { capture: true });

    const mo = new MutationObserver((records) => {
      if (!this.host.isConnected) return;
      if (records.every((r) => this.host.contains(r.target))) return;
      this.markDirty();
    });
    mo.observe(this.root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "open", "style"] });
    this.cleanups.push(() => mo.disconnect());
    // The page grows and shrinks as content loads: the overlay follows it.
    if (typeof ResizeObserver === "function" && this.doc.body) {
      const ro = new ResizeObserver(() => {
        if (this.host.isConnected) this.fitHost();
      });
      ro.observe(this.doc.body);
      this.cleanups.push(() => ro.disconnect());
    }
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.on_) return;
    if (e.button === 2) {
      // The right button cancels the stroke in progress, or takes away the stroke under it.
      e.preventDefault();
      if (this.stroke) this.cancelStroke();
      else this.removeStrokeAt([e.clientX, e.clientY]);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    this.glass.setPointerCapture(e.pointerId);
    const erase = e.altKey;
    // A stroke that starts on a fixed bar is painted on the bar, on the screen layer.
    const under = deepElementAt(this.doc, e.clientX, e.clientY, (el) => el === this.host, this.shadowOf);
    const layer: Layer = under && this.bars.some((b) => flatContains(b, under)) ? "screen" : "page";
    const client: Point = [e.clientX, e.clientY];
    const p = layer === "page" ? this.local(e.clientX, e.clientY) : client;
    this.pointer = client;
    const paint = this.layers[layer].begin(p, this.radius, erase, this.mark);
    this.stroke = { layer, erase, last: p, paint, before: new Set(this.picks) };
    this.emit("start", { erase });
    this.near = [];
    const at = this.local(e.clientX, e.clientY);
    this.brushSegment(at, at, this.stroke);
    this.schedule();
  }

  private pointerMove(e: PointerEvent): void {
    this.pointer = [e.clientX, e.clientY];
    // A second button pressed during a drag arrives as a move: right cancels the stroke.
    if (this.stroke && e.button === 2) {
      this.cancelStroke();
      return;
    }
    if (this.stroke) {
      this.brushTo(this.pointer);
      this.autoscroll(e.clientY);
    } else this.hover();
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.stroke) return;
    this.brushTo([e.clientX, e.clientY]);
    this.finishStroke();
    this.hover();
  }

  private brushTo(client: Point): void {
    const s = this.stroke;
    if (!s) return;
    const [ox, oy] = this.origin();
    const p: Point = s.layer === "page" ? [client[0] - ox, client[1] - oy] : client;
    if (Math.hypot(p[0] - s.last[0], p[1] - s.last[1]) < 0.5) return;
    this.layers[s.layer].extend(p);
    // Selection works in page coordinates; screen paint is measured where it is right now.
    const toPage = (q: Point): Point => (s.layer === "page" ? q : [q[0] - ox, q[1] - oy]);
    this.brushSegment(toPage(s.last), toPage(p), s);
    s.last = p;
    this.schedule();
  }

  /** Takes back the stroke in progress: its paint and the selection it made. */
  private cancelStroke(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.layers[s.layer].cancel();
    this.picks.clear();
    for (const el of s.before) this.picks.add(el);
    this.stopAutoscroll();
    this.emit("end", { erase: s.erase, cancelled: true, mark: s.paint.mark, point: this.pointer ? [this.pointer[0], this.pointer[1]] : [0, 0] });
    this.changed();
    if (this.pointer) this.hover();
  }

  private finishStroke(): void {
    const s = this.stroke;
    if (!s) return;
    this.layers[s.layer].end();
    this.record({ kind: "add", layer: s.layer, stroke: s.paint });
    this.stroke = null;
    this.stopAutoscroll();
    if (this.repickDue) {
      this.repickDue = false;
      this.repick();
    }
    if (this.looksDue) {
      this.looksDue = false;
      this.applyLooks();
    }
    this.refreshMarks();
    this.emit("end", { erase: s.erase, cancelled: false, mark: s.paint.mark, point: this.pointer ? [this.pointer[0], this.pointer[1]] : [0, 0] });
    if (this.dirty) this.markDirty();
    this.schedule();
  }

  /** Shows which elements the brush is over, in the next frame. */
  private hover(): void {
    if (!this.on_) return;
    this.hoverDue = true;
    this.schedule();
  }

  /** Finds the elements under the pointer that are not selected yet. */
  private findNear(): void {
    const client = this.pointer;
    if (!client || !this.on_ || this.stroke) {
      this.near = [];
      return;
    }
    const p = this.local(client[0], client[1]);
    const r = this.radius;
    const box = { x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r };
    this.near = [];
    for (const t of this.candidates(box)) if (!this.picks.has(t.el) && this.rectsOf(t).some((x) => strokeTouchesRect(p, p, r, x))) this.near.push(t);
  }

  private wheel(e: WheelEvent): void {
    if (e.ctrlKey) return;
    // The glass sits over the page, so the page's own scroll boxes do not get the wheel.
    // Pass it to the one under the pointer; the page itself scrolls on its own.
    const under = deepElementAt(this.doc, e.clientX, e.clientY, (el) => el === this.host, this.shadowOf);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.doc.documentElement.clientHeight : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    for (let el = under; el && el !== this.doc.body && el !== this.doc.documentElement; el = flatParent(el)) {
      if (canScroll(el, dx, dy)) {
        e.preventDefault();
        el.scrollBy({ left: dx, top: dy, behavior: "instant" });
        return;
      }
    }
  }

  private scrolled(e: Event): void {
    const t = e.target;
    const page = t === this.doc || t === this.doc.documentElement || t === this.doc.body;
    if (!page) {
      // A box that scrolls moves only what is inside it.
      if (t instanceof Element) this.relayoutInside(t);
      else this.relayout();
    }
    // Pinned elements stay on the screen, so in page terms they moved.
    else {
      for (const p of this.pinned) this.rects.delete(p);
      this.jitter.scrolled();
    }
    // Fixed bars stay on the screen while the page moves, so their clip moves in page terms.
    if (this.bars.length) this.updateClip();
    // Bars rarely change while the page scrolls: look for them in idle time, not in the scroll.
    if (!this.barsTimer) {
      const win = this.doc.defaultView!;
      const look = () => {
        this.barsTimer = 0;
        this.findBars();
      };
      if (typeof win.requestIdleCallback === "function") this.barsTimer = win.requestIdleCallback(look, { timeout: 250 });
      else this.barsTimer = win.setTimeout(look, 150);
    }
    if (!this.pointer || !this.on_) return;
    // The page moved under a still pointer: keep painting, or show what is under it now.
    if (this.stroke) this.brushTo(this.pointer);
    else this.hover();
  }

  private autoscroll(clientY: number): void {
    const edge = 32;
    const vh = this.doc.documentElement.clientHeight;
    let v = 0;
    if (clientY < edge) v = -(edge - clientY);
    else if (clientY > vh - edge) v = clientY - (vh - edge);
    this.autoSpeed = clamp(v * 0.7, -36, 36);
    if (!this.autoSpeed) return this.stopAutoscroll();
    if (this.autoFrame) return;
    const step = () => {
      if (!this.stroke || !this.autoSpeed) {
        this.autoFrame = 0;
        return;
      }
      this.doc.defaultView!.scrollBy({ top: this.autoSpeed, behavior: "instant" });
      this.autoFrame = requestAnimationFrame(step);
    };
    this.autoFrame = requestAnimationFrame(step);
  }

  private stopAutoscroll(): void {
    this.autoSpeed = 0;
    cancelAnimationFrame(this.autoFrame);
    this.autoFrame = 0;
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.on_) return;
    if (e.key === "Alt") {
      // Alt on its own would move focus to the browser's menu on Windows.
      e.preventDefault();
      this.setAlt(true);
      return;
    }
    const first = e.composedPath()[0];
    if (first instanceof Element && isEditable(first)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (ctrl && key === "z") e.shiftKey ? this.redo() : this.undo();
    else if (ctrl && key === "y") this.redo();
    else if (!ctrl && key === "[") this.size = this.radius - 2;
    else if (!ctrl && key === "]") this.size = this.radius + 2;
    else if (!ctrl && (key === "Delete" || key === "Backspace")) this.clear();
    else if (key === "Escape") {
      if (this.stroke) this.cancelStroke();
      else this.disable();
    }
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (!this.on_ || e.key !== "Alt") return;
    e.preventDefault();
    this.setAlt(false);
  }

  private setAlt(on: boolean): void {
    if (this.alt === on) return;
    this.alt = on;
    this.refreshCursor();
  }

  private copy(e: ClipboardEvent): void {
    const native = this.doc.getSelection();
    if ((native && !native.isCollapsed) || !this.picks.size || !e.clipboardData) return;
    const text = this.text();
    if (!text) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  }

  /* ---------- drawing ---------- */

  private refreshCursor(): void {
    this.glass.style.cursor = ringCursor(this.radius, this.alt);
  }

  private updateHud(): void {
    const n = this.pickedTargets().length;
    this.hudCount.textContent = n ? `${n} selected` : "Paint over the page to select";
  }

  private schedule(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    if (!this.host.isConnected) return;
    const [ox, oy] = this.origin();
    // Screen marks are drawn where their elements are on the screen right now.
    const place = (layer: Layer, r: Rect): Rect => (layer === "page" ? r : { x0: r.x0 + ox, y0: r.y0 + oy, x1: r.x1 + ox, y1: r.y1 + oy });
    if (this.looksDue) {
      this.looksDue = false;
      this.applyLooks();
    }
    // A page framework can redraw an element and drop its look; put it back.
    this.looks.restore();
    if (this.hoverDue) {
      this.hoverDue = false;
      this.findNear();
    }
    const near: Record<Layer, Rect[]> = { page: [], screen: [] };
    if (this.on_ && !this.stroke) {
      for (const t of this.near) {
        const layer = this.layerOf(t);
        const box = boundsOf(this.rectsOf(t));
        if (box) near[layer].push(pad(place(layer, box)));
      }
    }
    for (const layer of ["page", "screen"] as const) {
      const m = this.overlays[layer];
      setD(m.near, near[layer].map((r) => `M${r.x0 + 0.5} ${r.y0 + 0.5}H${r.x1 - 0.5}V${r.y1 - 0.5}H${r.x0 + 0.5}Z`).join(""));
    }
    this.drawBadges();
  }

  /**
   * Numbers each mark at the top left of its paint, once there is more than one mark or a note,
   * so the user sees which note belongs to which paint.
   */
  private drawBadges(): void {
    const show = this.markList.length > 1 || this.markList.some((m) => this.notes.has(m.id));
    const key = show ? this.markList.map((m) => `${m.layer}:${m.n}:${Math.round(m.box.x0)},${Math.round(m.box.y0)}:${this.notes.has(m.id) ? 1 : 0}`).join("|") : "";
    for (const layer of ["page", "screen"] as const) {
      const g = this.overlays[layer].badges;
      const mine = key ? this.markList.filter((m) => m.layer === layer) : [];
      const want = mine.map((m) => `${m.n}:${Math.round(m.box.x0)},${Math.round(m.box.y0)}:${this.notes.has(m.id) ? 1 : 0}`).join("|");
      if (g.dataset.key === want) continue;
      g.dataset.key = want;
      g.replaceChildren(
        ...mine.map((m) => {
          const b = this.doc.createElementNS(NS, "g");
          b.setAttribute("class", this.notes.has(m.id) ? "badge noted" : "badge");
          b.setAttribute("transform", `translate(${Math.round(m.box.x0)} ${Math.round(m.box.y0)})`);
          const c = this.doc.createElementNS(NS, "circle");
          c.setAttribute("r", "10");
          const t = this.doc.createElementNS(NS, "text");
          t.textContent = String(m.n);
          b.append(c, t);
          return b;
        }),
      );
    }
  }
}

/**
 * True when a box close around an element clips it, as a rounded card clips its picture: a tilt
 * would cut off the corners and the edge drawn outside it would not show.
 */
function clippedClosely(el: Element): boolean {
  const r = el.getBoundingClientRect();
  for (let e = flatParent(el), depth = 0; e && depth < 4; e = flatParent(e), depth++) {
    const cs = getComputedStyle(e);
    if (cs.overflowX === "visible" && cs.overflowY === "visible" && cs.clipPath === "none") continue;
    const b = e.getBoundingClientRect();
    const near = 12;
    if (r.left - b.left < near || r.top - b.top < near || b.right - r.right < near || b.bottom - r.bottom < near) return true;
  }
  return false;
}

/** The text nodes inside an element, such as a button's label. */
function textNodesIn(el: Element): Text[] {
  const out: Text[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\S/.test((n as Text).data)) out.push(n as Text);
  return out;
}

/** Strokes drawn small on a canvas of their own, to ask how much of a rectangle they cover. */
function rasterize(doc: Document, strokes: PaintStroke[], region: Rect, scale: number): { coverage(r: Rect): number } {
  const w = region.x1 - region.x0, h = region.y1 - region.y0;
  const k = Math.min(scale, 4096 / Math.max(1, w, h));
  const cw = Math.max(1, Math.ceil(w * k)), ch = Math.max(1, Math.ceil(h * k));
  const canvas = doc.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.setTransform(k, 0, 0, k, -region.x0 * k, -region.y0 * k);
  drawMarks(c, strokes.map((s) => ({ erase: s.erase, radius: s.radius, points: s.points as [number, number][] })), "#000");
  const data = c.getImageData(0, 0, cw, ch).data;
  return {
    coverage(r) {
      const x0 = Math.max(0, Math.floor((r.x0 - region.x0) * k)), x1 = Math.min(cw, Math.max(x0 + 1, Math.round((r.x1 - region.x0) * k)));
      const y0 = Math.max(0, Math.floor((r.y0 - region.y0) * k)), y1 = Math.min(ch, Math.max(y0 + 1, Math.round((r.y1 - region.y0) * k)));
      if (x1 <= x0 || y1 <= y0) return 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * cw + x) * 4 + 3]! >= 96) n++;
      return n / ((x1 - x0) * (y1 - y0));
    },
  };
}

/** The box around the paint that still shows from a list of strokes, or null when none does. */
function paintBox(doc: Document, strokes: PaintStroke[]): Rect | null {
  let b: Rect | null = null;
  for (const s of strokes) {
    if (s.erase) continue;
    for (let i = 0; i < s.points.length; i++) b = unionRect(b, segmentBounds(s.points[i]!, s.points[Math.max(0, i - 1)]!, s.radius));
  }
  if (!b) return null;
  if (!strokes.some((s) => s.erase)) return b;
  // Erasing may have taken some or all of it away: look at what is left, a quarter of the size.
  const k = Math.min(0.25, 1024 / Math.max(b.x1 - b.x0, b.y1 - b.y0));
  const cw = Math.max(1, Math.ceil((b.x1 - b.x0) * k)), ch = Math.max(1, Math.ceil((b.y1 - b.y0) * k));
  const canvas = doc.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
  drawMarks(c, strokes.map((s) => ({ erase: s.erase, radius: s.radius, points: s.points as [number, number][] })), "#000");
  const data = c.getImageData(0, 0, cw, ch).data;
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (data[(y * cw + x) * 4 + 3]! < 96) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0: b.x0 + x0 / k, y0: b.y0 + y0 / k, x1: b.x0 + (x1 + 1) / k, y1: b.y0 + (y1 + 1) / k };
}

/** Draws strokes in order, the erasing ones taking paint away. */
function drawMarks(c: CanvasRenderingContext2D, strokes: PaintMark[], color: string): void {
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const s of strokes) {
    c.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    c.strokeStyle = c.fillStyle = color;
    c.lineWidth = s.radius * 2;
    c.beginPath();
    const [first, ...rest] = s.points;
    if (!first) continue;
    if (!rest.length) {
      c.arc(first[0], first[1], s.radius, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    c.moveTo(first[0], first[1]);
    for (const p of rest) c.lineTo(p[0], p[1]);
    c.stroke();
  }
  c.globalCompositeOperation = "source-over";
}

/** The language of an element's text, for splitting it into words. */
function langOf(el: Element): string | undefined {
  return el.closest("[lang]")?.getAttribute("lang") || el.ownerDocument.documentElement.lang || undefined;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { x0, y0, x1, y1 };
}

/** The keys of the grid cells a rectangle covers. */
function cellsOf(r: Rect): string[] {
  const keys: string[] = [];
  for (let cy = Math.floor(r.y0 / CELL); cy <= Math.floor(r.y1 / CELL); cy++) {
    for (let cx = Math.floor(r.x0 / CELL); cx <= Math.floor(r.x1 / CELL); cx++) keys.push(`${cx},${cy}`);
  }
  return keys;
}

/** A few pixels out, on whole pixels. */
function pad(r: Rect): Rect {
  return { x0: Math.round(r.x0 - PAD), y0: Math.round(r.y0 - PAD), x1: Math.round(r.x1 + PAD), y1: Math.round(r.y1 + PAD) };
}

/** Text, or a box big enough to matter; small icons such as a copy button do not count. */
function worthSelecting(t: Target): boolean {
  if (t.texts.some((n) => /\S/.test(n.data))) return true;
  const r = t.el.getBoundingClientRect();
  return r.width * r.height >= 48 * 40;
}

function flatContains(outer: Element, inner: Node): boolean {
  for (let n: Node | null = inner; n; n = flatParent(n)) if (n === outer) return true;
  return false;
}

/** True when something between a hit element and its bar paints a solid background. */
function opaqueBetween(hit: Element, bar: Element): boolean {
  for (let e: Element | null = hit; e; e = flatParent(e)) {
    const cs = getComputedStyle(e);
    const m = /rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,/]+([\d.]+%?))?/.exec(cs.backgroundColor);
    const alpha = m ? (m[1] === undefined ? 1 : m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1])) : 0;
    if (alpha >= 0.85 || cs.backdropFilter !== "none" || cs.backgroundImage !== "none") return true;
    if (e === bar) break;
  }
  return false;
}

/** True when the page's own background is dark. */
function isDarkPage(doc: Document): boolean {
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/.exec(getComputedStyle(el).backgroundColor);
    if (!m) continue;
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha < 0.5) continue;
    const lum = (0.2126 * +m[1]! + 0.7152 * +m[2]! + 0.0722 * +m[3]!) / 255;
    return lum < 0.4;
  }
  return false;
}

function setD(p: SVGPathElement, d: string): void {
  if (d) p.setAttribute("d", d);
  else p.removeAttribute("d");
}

/** The brush itself as the pointer: a ring the size of the brush, dashed while it erases. */
function ringCursor(radius: number, erase: boolean): string {
  const size = Math.min(128, Math.ceil(radius * 2 + 6));
  const c = size / 2;
  const dash = erase ? ' stroke-dasharray="4 3"' : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">` +
    `<circle cx="${c}" cy="${c}" r="${radius}" stroke="#fff" stroke-width="3" stroke-opacity="0.9"/>` +
    `<circle cx="${c}" cy="${c}" r="${radius}" stroke="#111" stroke-width="1.2"${dash}/>` +
    `<path d="M${c - 3} ${c}H${c + 3}M${c} ${c - 3}V${c + 3}" stroke="#111" stroke-width="1"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
}

function hostStyle(z: number, color?: string): string {
  // Inline and important, so page rules such as `html > *` cannot move or hide the host.
  // A colour the project chose is used for the hover outline too.
  const paint = color ? [`--ws-paint: ${color}`, `--ws-near: ${color}`] : [];
  return [
    ...paint,
    "all: initial !important",
    "display: block !important",
    "position: absolute !important",
    "top: 0 !important",
    "left: 0 !important",
    "width: 0",
    "height: 0",
    "margin: 0 !important",
    "padding: 0 !important",
    "border: 0 !important",
    // Paint past the edge of the page is cut off, so it never makes the page bigger. Fixed
    // parts, such as the glass and the status line, belong to the screen and are not cut.
    "overflow: clip !important",
    "transform: none !important",
    "pointer-events: none !important",
    `z-index: ${z} !important`,
  ].join(";");
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "password", "tel", "number", "date", "time", "datetime-local", "month", "week"]);

function isEditable(el: Element): boolean {
  const t = el.localName;
  if (t === "input") return TEXT_INPUTS.has((el as HTMLInputElement).type);
  return t === "textarea" || t === "select" || (el as HTMLElement).isContentEditable;
}

function canScroll(el: Element, dx: number, dy: number): boolean {
  const cs = getComputedStyle(el);
  const sy = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
  const sx = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
  if (dy && sy && (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
  if (dx && sx && (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return true;
  return false;
}

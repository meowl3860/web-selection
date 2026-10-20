// The selection tool: it owns the page index, the selection, the history and the overlay,
// and turns pointer and key input into selection changes.

import { rectFromPoints, sampleSegment, type Point } from "./core/geometry.js";
import { deepElementAt, flatContains, flatParent, openShadow, type ShadowOf } from "./core/dom.js";
import { blockAtPoint, caretAt, Hits } from "./core/hit.js";
import { combine, equals, normalize, subtract, union, type Interval, type IntervalSet, type Mode } from "./core/intervals.js";
import { PageIndex, type Block } from "./core/page.js";
import { SelectionSnapshot } from "./core/snapshot.js";
import { spanOfBlocks, Wand } from "./core/wand.js";
import { cursorFor, type Tool } from "./view/cursors.js";
import { Overlay } from "./view/overlay.js";
import { Palette } from "./view/palette.js";
import { Measure, regionOf, type Region } from "./view/region.js";

export type { Mode, Tool };
export type View = "ants" | "mask";

export type Command =
  | "selectAll" | "deselect" | "reselect" | "invert" | "grow" | "similar"
  | "expand" | "contract" | "mainText" | "undo" | "redo";

export interface Settings {
  tool: Tool;
  /** The mode a plain click uses. Shift, Alt and Shift+Alt override it for one gesture. */
  mode: Mode;
  /** Magic wand: how alike blocks must look, 0 to 100. */
  tolerance: number;
  /** Magic wand: only the run around the click, or every alike block on the page. */
  contiguous: boolean;
  /** Marquee and lasso: take whole blocks instead of the exact characters. */
  wholeBlocks: boolean;
  /** Brush radius in pixels. */
  brushSize: number;
  /**
   * Brush: take each block it touches whole, like Photoshop's Quick Selection. Off, it paints
   * the exact characters under it, like painting a Quick Mask.
   */
  brushBlocks: boolean;
  view: View;
}

export interface WebSelectionOptions extends Partial<Settings> {
  /** Where to select. The default is the page body. */
  root?: Element;
  /** Leaves elements, and everything inside them, out of the selection. */
  exclude?: (el: Element) => boolean;
  /** Shows the built-in tool bar. The default is true. */
  palette?: boolean;
  zIndex?: number;
  /** Escape turns the tools off when no drag is in progress. The default is true. */
  exitOnEscape?: boolean;
  /**
   * How to reach an element's shadow root. The default reaches open ones; an extension can pass
   * `chrome.dom.openOrClosedShadowRoot` to reach closed ones too.
   */
  shadowRoot?: ShadowOf;
}

export interface Events {
  change: SelectionSnapshot;
  settings: Readonly<Settings>;
  enabled: boolean;
  /** Enter was pressed: the user is done and wants to use the selection. */
  commit: SelectionSnapshot;
}

export interface WebSelection {
  readonly enabled: boolean;
  readonly settings: Readonly<Settings>;
  readonly selection: SelectionSnapshot;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  enable(): void;
  disable(): void;
  toggle(): void;
  destroy(): void;
  set(patch: Partial<Settings>): void;
  run(command: Command): void;
  /** Selects elements or a range from code, with the given mode. */
  select(target: Element | readonly Element[] | Range, mode?: Mode): void;
  on<K extends keyof Events>(type: K, fn: (value: Events[K]) => void): () => void;
}

const DEFAULTS: Settings = {
  tool: "wand",
  mode: "new",
  tolerance: 20,
  contiguous: true,
  wholeBlocks: false,
  brushSize: 14,
  brushBlocks: true,
  view: "ants",
};

type Gesture =
  | { tool: "wand"; mode: Mode; start: Point; moved: boolean }
  | { tool: "marquee"; mode: Mode; start: Point; end: Point; hits: Hits; region: IntervalSet }
  | { tool: "lasso"; mode: Mode; points: Point[]; hits: Hits; region: IntervalSet }
  | { tool: "brush"; mode: Mode; base: IntervalSet; painted: Set<Block>; exact: IntervalSet; last: Point; hits: Hits }
  | { tool: "text"; mode: Mode; base: IntervalSet; anchor: number; focus: number };

export function createWebSelection(options: WebSelectionOptions = {}): WebSelection {
  return new Controller(options);
}

class Controller implements WebSelection {
  private readonly doc: Document;
  private readonly root: Element;
  private readonly overlay: Overlay;
  private readonly palette: Palette | null;
  private readonly listeners = new Map<keyof Events, Set<(v: never) => void>>();
  private readonly cleanups: (() => void)[] = [];
  private readonly opts: WebSelectionOptions;
  private state: Settings;
  private on_ = false;
  private destroyed = false;

  private index: PageIndex | null = null;
  private wand: Wand | null = null;
  private version = 0;
  private dirty = true;
  private rebuildTimer = 0;
  private rebuildDelay = 200;

  /** The selection, kept as live DOM ranges so it follows the page when the page changes. */
  private ranges: Range[] = [];
  private revision = 0;
  private cache: { version: number; revision: number; set: IntervalSet } | null = null;
  private history: Range[][] = [];
  private future: Range[][] = [];
  private lastDropped: Range[] | null = null;

  private gesture: Gesture | null = null;
  private live: IntervalSet | null = null;
  private liveRev = 0;
  private preview: IntervalSet = [];
  private previewMode: Mode = "new";
  private previewKey = "";
  private hoverAt: Point | null = null;
  private lastClient: Point = [0, 0];
  private mods = { shiftKey: false, altKey: false };

  private frame = 0;
  private layoutEpoch = 0;
  private drawn: { key: string; region: Region } | null = null;
  private drawnPreview: { key: string; region: Region } | null = null;
  private pinned = false;
  private autoFrame = 0;
  private autoSpeed = 0;

  constructor(options: WebSelectionOptions) {
    this.opts = options;
    this.doc = options.root?.ownerDocument ?? document;
    this.root = options.root ?? this.doc.body;
    this.state = { ...DEFAULTS, ...pickSettings(options) };
    this.shadowOf = options.shadowRoot ?? openShadow;
    this.overlay = new Overlay(this.doc, options.zIndex ?? 2147483646);
    this.palette = options.palette === false ? null : new Palette(this.overlay.ui, this);
    this.bind();
  }

  /* ---------- public ---------- */

  get enabled(): boolean {
    return this.on_;
  }

  get settings(): Readonly<Settings> {
    return this.state;
  }

  get selection(): SelectionSnapshot {
    return new SelectionSnapshot(this.ensureIndex(), this.currentSet());
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  enable(): void {
    if (this.destroyed || this.on_) return;
    this.on_ = true;
    this.overlay.attach();
    this.overlay.glassOn = true;
    this.ensureIndex();
    // Keys go to the tools, not to a field on the page that had focus.
    const active = this.doc.activeElement as HTMLElement | null;
    if (active && active !== this.doc.body && isEditable(active)) active.blur();
    this.refreshCursor();
    this.palette?.show(true);
    this.palette?.update();
    this.emit("enabled", true);
    this.schedule();
  }

  disable(): void {
    if (!this.on_) return;
    this.on_ = false;
    this.cancelGesture();
    this.overlay.glassOn = false;
    this.clearPreview();
    this.palette?.show(false);
    if (!this.ranges.length) this.overlay.detach();
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
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.autoFrame) cancelAnimationFrame(this.autoFrame);
    clearTimeout(this.rebuildTimer);
    this.overlay.detach();
    this.listeners.clear();
  }

  set(patch: Partial<Settings>): void {
    const next = { ...this.state, ...pickSettings(patch) };
    next.tolerance = clamp(Math.round(next.tolerance), 0, 100);
    next.brushSize = clamp(Math.round(next.brushSize), 3, 80);
    const changed = (Object.keys(next) as (keyof Settings)[]).some((k) => next[k] !== this.state[k]);
    if (!changed) return;
    const toolChanged = next.tool !== this.state.tool;
    this.state = next;
    if (toolChanged) this.cancelGesture();
    this.previewKey = "";
    this.refreshCursor();
    if (this.hoverAt) this.hover(this.hoverAt[0], this.hoverAt[1]);
    else this.clearPreview();
    this.palette?.update();
    this.emit("settings", this.state);
    this.schedule();
  }

  run(command: Command): void {
    const index = this.ensureIndex();
    const wand = this.wand!;
    const cur = this.currentSet();
    const blocks = index.blocksOf(cur);
    const t = this.state.tolerance;
    switch (command) {
      case "selectAll":
        return this.commit(index.tidy(index.universe()));
      case "deselect":
        return this.commit([]);
      case "reselect":
        if (this.lastDropped) this.commit(this.setOfRanges(this.lastDropped));
        return;
      case "invert":
        return this.commit(index.tidy(subtract(index.universe(), cur)));
      case "grow":
        return this.commit(union(cur, spanOfBlocks(wand.grow(blocks, t))));
      case "similar":
        return this.commit(union(cur, spanOfBlocks(wand.similar(blocks, t))));
      case "expand":
        return this.commit(union(cur, spanOfBlocks(wand.expand(blocks))));
      case "contract": {
        const keep = new Set(wand.contract(blocks));
        return this.commit(subtract(cur, spanOfBlocks(blocks.filter((b) => !keep.has(b)))));
      }
      case "mainText":
        return this.commit(combine(cur, spanOfBlocks(wand.mainText()), this.state.mode));
      case "undo":
        return this.undo();
      case "redo":
        return this.redo();
    }
  }

  select(target: Element | readonly Element[] | Range, mode: Mode = "new"): void {
    const index = this.ensureIndex();
    let region: IntervalSet;
    if (target instanceof Range) region = index.setOfRange(target);
    else {
      const els = Array.isArray(target) ? target : [target as Element];
      const list: Interval[] = [];
      for (const el of els) list.push(...index.setOfElement(el));
      region = normalize(list);
    }
    this.commit(combine(this.currentSet(), index.tidy(region), mode));
  }

  on<K extends keyof Events>(type: K, fn: (value: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set!.delete(fn as (v: never) => void);
  }

  /* ---------- selection state ---------- */

  private emit<K extends keyof Events>(type: K, value: Events[K]): void {
    for (const fn of this.listeners.get(type) ?? []) {
      try {
        (fn as (v: Events[K]) => void)(value);
      } catch (err) {
        console.error("[web-selection] listener failed", err);
      }
    }
  }

  private ensureIndex(): PageIndex {
    if (!this.index || (this.dirty && !this.gesture)) {
      const t0 = performance.now();
      const host = this.overlay.host;
      const exclude = this.opts.exclude;
      this.index = new PageIndex(
        { root: this.root, exclude: (el) => el === host || (exclude ? exclude(el) : false), shadowOf: this.shadowOf },
        ++this.version,
      );
      // Changes inside shadow roots do not reach an observer on the page, so watch each root.
      for (const r of this.index.shadowRoots) this.watch?.(r);
      this.wand = new Wand(this.index);
      this.dirty = false;
      this.previewKey = "";
      // A page that changes all the time gets rebuilt less often.
      const took = performance.now() - t0;
      this.rebuildDelay = clamp(took * 8, 200, 2000);
    }
    return this.index;
  }

  private markDirty(): void {
    this.dirty = true;
    this.layoutEpoch++;
    // Nothing is shown, so the next use rebuilds the index; no need to watch the clock.
    if (!this.overlay.host.isConnected) return;
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      if (this.destroyed || !this.overlay.host.isConnected) return;
      if (this.gesture) return this.markDirty();
      this.ensureIndex();
      if (this.hoverAt && this.on_) this.hover(this.hoverAt[0], this.hoverAt[1]);
      this.schedule();
    }, this.rebuildDelay);
    this.schedule();
  }

  private currentSet(): IntervalSet {
    const index = this.ensureIndex();
    const c = this.cache;
    if (c && c.version === index.version && c.revision === this.revision) return c.set;
    const set = this.setOfRanges(this.ranges);
    this.cache = { version: index.version, revision: this.revision, set };
    return set;
  }

  private setOfRanges(ranges: readonly Range[]): IntervalSet {
    const index = this.ensureIndex();
    return normalize(ranges.flatMap((r) => [...index.setOfRange(r)]));
  }

  private commit(set: IntervalSet): void {
    const index = this.ensureIndex();
    const prev = this.currentSet();
    if (equals(prev, set)) return;
    this.history.push(this.ranges);
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    if (!set.length && prev.length) this.lastDropped = this.ranges;
    this.ranges = set.flatMap((iv) => index.rangesOf(iv));
    this.changed(set);
  }

  private changed(set?: IntervalSet): void {
    this.revision++;
    const index = this.ensureIndex();
    this.cache = set ? { version: index.version, revision: this.revision, set } : null;
    if (this.ranges.length) this.overlay.attach();
    else if (!this.on_) this.overlay.detach();
    this.palette?.update();
    this.emit("change", new SelectionSnapshot(index, this.currentSet()));
    this.schedule();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(this.ranges);
    this.ranges = prev;
    this.changed();
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(this.ranges);
    this.ranges = next;
    this.changed();
  }

  /* ---------- input ---------- */

  private bind(): void {
    const glass = this.overlay.glass;
    const win = this.doc.defaultView!;
    const listen = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    listen<PointerEvent>(glass, "pointerdown", (e) => this.pointerDown(e));
    listen<PointerEvent>(glass, "pointermove", (e) => this.pointerMove(e));
    listen<PointerEvent>(glass, "pointerup", (e) => this.pointerUp(e));
    listen<PointerEvent>(glass, "pointercancel", () => this.cancelGesture());
    listen<PointerEvent>(glass, "pointerleave", () => {
      if (!this.gesture) {
        this.hoverAt = null;
        this.clearPreview();
      }
    });
    listen<WheelEvent>(glass, "wheel", (e) => this.wheel(e), { passive: false });
    listen<MouseEvent>(glass, "dblclick", (e) => e.preventDefault());
    // Pointer events carry no click count, so double and triple clicks come from "click".
    listen<MouseEvent>(glass, "click", (e) => this.multiClick(e));
    listen<KeyboardEvent>(win, "keydown", (e) => this.keyDown(e), { capture: true });
    listen<KeyboardEvent>(win, "keyup", (e) => this.keyUp(e), { capture: true });
    listen<FocusEvent>(win, "blur", () => {
      this.mods = { shiftKey: false, altKey: false };
      this.refreshCursor();
    });
    listen<ClipboardEvent>(this.doc, "copy", (e) => this.copy(e), { capture: true });
    listen<Event>(this.doc, "scroll", (e) => this.scrolled(e), { capture: true, passive: true });
    listen<Event>(win, "resize", () => this.markDirty());
    listen<Event>(this.doc, "load", () => this.relayout(), { capture: true });
    if (this.doc.fonts) listen<Event>(this.doc.fonts, "loadingdone", () => this.markDirty());

    const mo = new MutationObserver((records) => {
      if (!this.overlay.host.isConnected) return;
      const host = this.overlay.host;
      if (records.every((r) => host.contains(r.target))) return;
      this.markDirty();
    });
    const watching = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "open", "style"] };
    mo.observe(this.root, watching);
    mo.observe(this.doc.documentElement, { attributes: true });
    this.watch = (r) => mo.observe(r, watching);
    this.cleanups.push(() => mo.disconnect());

    if (typeof ResizeObserver === "function") {
      let first = true;
      const ro = new ResizeObserver(() => {
        if (first) {
          first = false;
          return;
        }
        if (this.overlay.host.isConnected) this.markDirty();
      });
      ro.observe(this.root);
      this.cleanups.push(() => ro.disconnect());
    }
  }

  private modeOf(e: { shiftKey: boolean; altKey: boolean }): Mode {
    if (e.shiftKey && e.altKey) return "intersect";
    if (e.shiftKey) return "add";
    if (e.altKey) return "subtract";
    return this.state.mode;
  }

  private local(clientX: number, clientY: number): Point {
    const o = this.overlay.origin();
    return [clientX - o.x, clientY - o.y];
  }

  private isOurs = (el: Element) => el === this.overlay.host;
  private watch: ((root: ShadowRoot) => void) | null = null;
  private readonly shadowOf: ShadowOf;

  private caretPosition(x: number, y: number): number | null {
    const index = this.ensureIndex();
    const c = this.overlay.through(() => caretAt(this.doc, x, y, index.shadowRoots));
    if (!c || this.overlay.host.contains(c.node)) return null;
    if (!flatContains(this.root, c.node)) return null;
    return index.position(c.node, c.offset);
  }

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.on_) return;
    e.preventDefault();
    this.overlay.glass.setPointerCapture(e.pointerId);
    this.cancelGesture();
    const index = this.ensureIndex();
    const mode = this.modeOf(e);
    const p = this.local(e.clientX, e.clientY);
    const hits = () => new Hits(index, () => this.overlay.origin());
    this.lastClient = [e.clientX, e.clientY];
    this.clearPreview();
    switch (this.state.tool) {
      case "wand":
        this.gesture = { tool: "wand", mode, start: [e.clientX, e.clientY], moved: false };
        break;
      case "marquee":
        this.gesture = { tool: "marquee", mode, start: p, end: p, hits: hits(), region: [] };
        break;
      case "lasso":
        this.gesture = { tool: "lasso", mode, points: [p], hits: hits(), region: [] };
        break;
      case "brush": {
        // As in Photoshop's quick selection, strokes after the first one add.
        const cur = this.currentSet();
        const m = mode === "new" && cur.length ? "add" : mode;
        const g: Gesture = { tool: "brush", mode: m, base: cur, painted: new Set(), exact: [], last: p, hits: hits() };
        this.gesture = g;
        this.live = m === "new" ? [] : cur;
        this.paint(g, [p]);
        break;
      }
      case "text": {
        const pos = this.caretPosition(e.clientX, e.clientY);
        if (pos === null) break;
        const cur = this.currentSet();
        this.gesture = { tool: "text", mode, base: cur, anchor: pos, focus: pos };
        this.live = cur;
        break;
      }
    }
    this.schedule();
  }

  private pointerMove(e: PointerEvent): void {
    this.lastClient = [e.clientX, e.clientY];
    if (!this.gesture) {
      this.hover(e.clientX, e.clientY);
      return;
    }
    this.track(e.clientX, e.clientY);
    this.autoscroll(e.clientY);
  }

  private track(x: number, y: number): void {
    const g = this.gesture;
    if (!g) return;
    const p = this.local(x, y);
    switch (g.tool) {
      case "wand":
        if (Math.hypot(x - g.start[0], y - g.start[1]) > 4) g.moved = true;
        break;
      case "marquee": {
        g.end = p;
        let region = g.hits.inShape({ type: "rect", rect: rectFromPoints(g.start, g.end) });
        if (this.state.wholeBlocks) region = spanOfBlocks(this.index!.blocksOf(region));
        g.region = region;
        this.setPreview(region, g.mode);
        break;
      }
      case "lasso": {
        const last = g.points[g.points.length - 1]!;
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2.5) g.points.push(p);
        let region = g.hits.inShape({ type: "polygon", points: g.points });
        if (this.state.wholeBlocks) region = spanOfBlocks(this.index!.blocksOf(region));
        g.region = region;
        this.setPreview(region, g.mode);
        break;
      }
      case "brush":
        this.paint(g, sampleSegment(g.last, p, Math.max(2, this.state.brushSize / 2)));
        g.last = p;
        this.hoverAt = [x, y];
        break;
      case "text": {
        const pos = this.caretPosition(x, y);
        if (pos !== null && pos !== g.focus) {
          g.focus = pos;
          const a = Math.min(g.anchor, g.focus);
          const b = Math.max(g.anchor, g.focus);
          this.live = combine(g.base, b > a ? this.index!.tidy([[a, b]]) : [], g.mode);
          this.liveRev++;
        }
        break;
      }
    }
    this.schedule();
  }

  private paint(g: Extract<Gesture, { tool: "brush" }>, points: Point[]): void {
    let grew = false;
    if (this.state.brushBlocks) {
      for (const b of g.hits.brushed(points, this.state.brushSize)) {
        if (!g.painted.has(b)) {
          g.painted.add(b);
          grew = true;
        }
      }
    } else {
      const dab = g.hits.inShape({ type: "stroke", points, radius: this.state.brushSize });
      const next = union(g.exact, dab);
      grew = !equals(next, g.exact);
      g.exact = next;
    }
    if (grew || !this.live) {
      const painted = this.state.brushBlocks ? spanOfBlocks(g.painted) : g.exact;
      this.live = combine(g.base, painted, g.mode);
      this.liveRev++;
    }
  }

  private pointerUp(e: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    this.track(e.clientX, e.clientY);
    this.gesture = null;
    this.stopAutoscroll();
    const cur = this.currentSet();
    switch (g.tool) {
      case "wand": {
        if (g.moved) break;
        const block = blockAtPoint(this.ensureIndex(), e.clientX, e.clientY, this.isOurs, this.shadowOf);
        if (block) this.commit(combine(cur, spanOfBlocks(this.wand!.pick(block, this.state.tolerance, this.state.contiguous)), g.mode));
        else if (g.mode === "new") this.commit([]);
        break;
      }
      case "marquee": {
        const w = Math.abs(g.end[0] - g.start[0]);
        const h = Math.abs(g.end[1] - g.start[1]);
        if (w < 3 && h < 3) {
          if (g.mode === "new") this.commit([]);
        } else this.commit(combine(cur, g.region, g.mode));
        break;
      }
      case "lasso":
        if (g.points.length < 3) {
          if (g.mode === "new") this.commit([]);
        } else this.commit(combine(cur, g.region, g.mode));
        break;
      case "brush":
        if (this.live) this.commit(this.live);
        break;
      case "text":
        if (g.anchor === g.focus) {
          if (g.mode === "new") this.commit([]);
        } else if (this.live) this.commit(this.live);
        break;
    }
    this.live = null;
    this.clearPreview();
    if (this.dirty) this.markDirty();
    this.hover(e.clientX, e.clientY);
  }

  private cancelGesture(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.live = null;
    this.stopAutoscroll();
    this.clearPreview();
  }

  private hover(x: number, y: number): void {
    this.hoverAt = [x, y];
    if (!this.on_) return;
    const tool = this.state.tool;
    if (tool === "wand") {
      const index = this.ensureIndex();
      const block = blockAtPoint(index, x, y, this.isOurs, this.shadowOf);
      const key = block ? `${index.version}:${block.order}:${this.state.tolerance}:${+this.state.contiguous}` : "none";
      const mode = this.modeOf(this.mods);
      if (key !== this.previewKey || mode !== this.previewMode) {
        this.previewKey = key;
        this.setPreview(block ? spanOfBlocks(this.wand!.pick(block, this.state.tolerance, this.state.contiguous)) : [], mode);
      }
    } else if (tool !== "brush") this.clearPreview();
    this.schedule();
  }

  private setPreview(set: IntervalSet, mode: Mode): void {
    this.preview = set;
    this.previewMode = mode;
    this.drawnPreview = null;
  }

  private clearPreview(): void {
    if (!this.preview.length && !this.previewKey) return;
    this.preview = [];
    this.previewKey = "";
    this.drawnPreview = null;
    this.schedule();
  }

  private multiClick(e: MouseEvent): void {
    if (!this.on_ || this.state.tool !== "text" || (e.detail !== 2 && e.detail !== 3)) return;
    const pos = this.caretPosition(e.clientX, e.clientY);
    if (pos === null) return;
    const region = e.detail === 2 ? this.wordAt(pos) : this.blockAt(pos);
    if (region.length) this.commit(combine(this.currentSet(), region, this.modeOf(e)));
  }

  private wordAt(pos: number): IntervalSet {
    const index = this.ensureIndex();
    const atom = index.atomAt(pos) ?? index.atomAt(pos - 1);
    if (!atom || atom.type !== "text") return [];
    const text = atom.node.data;
    const at = pos - atom.start;
    const seg = new Intl.Segmenter(this.doc.documentElement.lang || undefined, { granularity: "word" });
    for (const s of seg.segment(text)) {
      if (at >= s.index && at < s.index + s.segment.length) {
        return s.isWordLike ? [[atom.start + s.index, atom.start + s.index + s.segment.length]] : [];
      }
    }
    return [];
  }

  private blockAt(pos: number): IntervalSet {
    const atom = this.ensureIndex().atomAt(pos);
    return atom ? atom.block.span : [];
  }

  private wheel(e: WheelEvent): void {
    if (e.ctrlKey) return;
    // The glass sits over the page, so the page's own scroll boxes do not get the wheel.
    // Pass it to the one under the pointer; the page itself scrolls on its own.
    const under = deepElementAt(this.doc, e.clientX, e.clientY, this.isOurs, this.shadowOf);
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

  private autoscroll(clientY: number): void {
    const edge = 32;
    const vh = this.doc.documentElement.clientHeight;
    const g = this.gesture;
    let v = 0;
    if (g && g.tool !== "wand") {
      if (clientY < edge) v = -(edge - clientY);
      else if (clientY > vh - edge) v = clientY - (vh - edge);
    }
    this.autoSpeed = clamp(v * 0.7, -36, 36);
    if (!this.autoSpeed) return this.stopAutoscroll();
    if (this.autoFrame) return;
    const step = () => {
      if (!this.gesture || !this.autoSpeed) {
        this.autoFrame = 0;
        return;
      }
      this.doc.defaultView!.scrollBy({ top: this.autoSpeed, behavior: "instant" });
      this.track(this.lastClient[0], this.lastClient[1]);
      this.autoFrame = requestAnimationFrame(step);
    };
    this.autoFrame = requestAnimationFrame(step);
  }

  private stopAutoscroll(): void {
    this.autoSpeed = 0;
    if (this.autoFrame) cancelAnimationFrame(this.autoFrame);
    this.autoFrame = 0;
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.on_) return;
    if (e.key === "Shift" || e.key === "Alt") {
      this.mods = { shiftKey: e.shiftKey, altKey: e.altKey };
      // Alt on its own would move focus to the browser's menu on Windows.
      if (e.key === "Alt") e.preventDefault();
      this.refreshCursor();
      if (this.hoverAt && !this.gesture) this.hover(this.hoverAt[0], this.hoverAt[1]);
      return;
    }
    const first = e.composedPath()[0];
    const inField = first instanceof Element && isEditable(first);
    if (inField && e.key !== "Escape") return;
    // A focused button in the tool bar keeps Enter and Space for itself.
    if (first instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (ctrl && !e.altKey) {
      if (key === "d") this.run(e.shiftKey ? "reselect" : "deselect");
      else if (key === "i" && !e.shiftKey) this.run("invert");
      else if (key === "a") this.run("selectAll");
      else if (key === "z") this.run(e.shiftKey ? "redo" : "undo");
      else if (key === "y") this.run("redo");
      else handled = false;
    } else if (!ctrl && !e.altKey) {
      const tools: Record<string, Tool> = { w: "wand", m: "marquee", l: "lasso", b: "brush", t: "text" };
      if (tools[key]) this.set({ tool: tools[key] });
      else if (key === "q") this.set({ view: this.state.view === "ants" ? "mask" : "ants" });
      else if (key === "[" || key === "]") this.nudge(key === "]" ? 1 : -1);
      else if (key === "Enter") this.emit("commit", this.selection);
      else if (key === "Escape") {
        if (this.gesture) this.cancelGesture();
        else if (this.opts.exitOnEscape !== false) this.disable();
        else handled = false;
      } else handled = false;
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (!this.on_) return;
    if (e.key === "Shift" || e.key === "Alt") {
      this.mods = { shiftKey: e.shiftKey, altKey: e.altKey };
      if (e.key === "Alt") e.preventDefault();
      this.refreshCursor();
      if (this.hoverAt && !this.gesture) this.hover(this.hoverAt[0], this.hoverAt[1]);
    }
  }

  private nudge(dir: 1 | -1): void {
    if (this.state.tool === "brush") this.set({ brushSize: this.state.brushSize + dir * 2 });
    else this.set({ tolerance: this.state.tolerance + dir * 5 });
  }

  private copy(e: ClipboardEvent): void {
    const native = this.doc.getSelection();
    if (native && !native.isCollapsed) return;
    if (!this.ranges.length || !e.clipboardData) return;
    const text = this.selection.text();
    if (!text) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  }

  private scrolled(e: Event): void {
    const t = e.target;
    const page = t === this.doc || t === this.doc.documentElement || t === this.doc.body;
    if (!page || this.pinned) this.relayout();
    if (this.hoverAt && this.on_ && !this.gesture) this.hover(this.hoverAt[0], this.hoverAt[1]);
  }

  private relayout(): void {
    this.layoutEpoch++;
    this.schedule();
  }

  private refreshCursor(): void {
    this.overlay.cursor = cursorFor(this.state.tool, this.modeOf(this.mods));
  }

  /* ---------- drawing ---------- */

  private schedule(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    if (!this.overlay.host.isConnected) return;
    const index = this.ensureIndex();
    const m = new Measure(this.doc, this.overlay.origin(), this.doc.defaultView?.devicePixelRatio || 1);
    const set = this.live ?? this.currentSet();
    const key = `${index.version}:${this.layoutEpoch}:${this.live ? "live" + this.liveRev : "rev" + this.revision}`;
    if (!this.drawn || this.drawn.key !== key) this.drawn = { key, region: regionOf(index, set, m) };
    const pkey = `${index.version}:${this.layoutEpoch}`;
    if (!this.drawnPreview || this.drawnPreview.key !== pkey) {
      this.drawnPreview = { key: pkey, region: this.preview.length ? regionOf(index, this.preview, m) : { loops: [], pinned: false } };
    }
    this.pinned = this.drawn.region.pinned || this.drawnPreview.region.pinned;
    const g = this.gesture;
    let shape: Parameters<Overlay["draw"]>[0]["shape"] = null;
    if (g?.tool === "marquee") shape = { type: "rect", rect: rectFromPoints(g.start, g.end) };
    else if (g?.tool === "lasso") shape = { type: "path", points: g.points };
    const showBrush = this.on_ && this.state.tool === "brush" && this.hoverAt;
    this.overlay.draw({
      selection: this.drawn.region.loops,
      preview: this.drawnPreview.region.loops,
      previewMode: this.previewMode,
      mask: this.state.view === "mask" && (this.on_ || set.length > 0),
      shape,
      brush: showBrush ? { at: this.local(this.hoverAt![0], this.hoverAt![1]), radius: this.state.brushSize } : null,
    });
  }
}

function pickSettings(o: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (o[k] !== undefined) (out as Record<string, unknown>)[k] = o[k];
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "password", "tel", "number", "date", "time", "datetime-local", "month", "week"]);

/** A field that takes typed text. Sliders and check boxes do not count. */
function isEditable(el: Element): boolean {
  const t = el.localName;
  if (t === "input") return TEXT_INPUTS.has((el as HTMLInputElement).type);
  return t === "textarea" || t === "select" || (el as HTMLElement).isContentEditable;
}

function canScroll(el: Element, dx: number, dy: number): boolean {
  const cs = getComputedStyle(el);
  const sy = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
  const sx = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
  if (dy && sy) {
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  if (dx && sx) {
    if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}

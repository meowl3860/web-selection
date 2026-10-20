// The overlay is one element at the page's origin with a shadow root, so page styles do not
// reach it and its styles do not reach the page. It never moves or changes the page's nodes.
// Shapes are drawn in page coordinates, so they scroll with the page without redrawing.
// While a tool is on, a clear "glass" covers the viewport and takes the pointer, so clicks
// select instead of following links, and the page's hover effects stay still.

import { loopsToPath, polylineToPath, type Loop, type Point, type Rect } from "../core/geometry.js";
import { overlayCss } from "./styles.js";

export type PreviewMode = "new" | "add" | "subtract" | "intersect";

export interface Scene {
  selection: Loop[];
  preview: Loop[];
  previewMode: PreviewMode;
  /** Mask view: tint everything outside the selection, like Quick Mask. */
  mask: boolean;
  /** The marquee or lasso being drawn. */
  shape: { type: "rect"; rect: Rect } | { type: "path"; points: readonly Point[] } | null;
  brush: { at: Point; radius: number } | null;
}

const NS = "http://www.w3.org/2000/svg";
export const HOST_TAG = "web-selection-overlay";

export class Overlay {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly glass: HTMLDivElement;
  readonly ui: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly maskPath: SVGPathElement;
  private readonly fillPath: SVGPathElement;
  private readonly antsA: SVGPathElement;
  private readonly antsB: SVGPathElement;
  private readonly previewFill: SVGPathElement;
  private readonly previewLine: SVGPathElement;
  private readonly shapeA: SVGPathElement;
  private readonly shapeB: SVGPathElement;
  private readonly brushA: SVGCircleElement;
  private readonly brushB: SVGCircleElement;

  constructor(private readonly doc: Document, zIndex: number) {
    this.host = doc.createElement(HOST_TAG);
    this.host.setAttribute("style", hostStyle(zIndex));
    this.root = this.host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = overlayCss;
    this.root.append(style);

    this.svg = doc.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "layer");
    this.svg.setAttribute("width", "1");
    this.svg.setAttribute("height", "1");
    this.svg.setAttribute("aria-hidden", "true");
    const path = (cls: string) => {
      const p = doc.createElementNS(NS, "path");
      p.setAttribute("class", cls);
      this.svg.append(p);
      return p;
    };
    this.maskPath = path("mask");
    this.fillPath = path("fill");
    this.previewFill = path("preview-fill");
    this.previewLine = path("preview-line");
    this.antsA = path("ants-a");
    this.antsB = path("ants-b");
    this.shapeA = path("ants-a shape");
    this.shapeB = path("ants-b shape");
    const circle = (cls: string) => {
      const c = doc.createElementNS(NS, "circle");
      c.setAttribute("class", cls);
      this.svg.append(c);
      return c;
    };
    this.brushA = circle("brush-a");
    this.brushB = circle("brush-b");
    this.root.append(this.svg);

    this.glass = doc.createElement("div");
    this.glass.className = "glass";
    this.glass.hidden = true;
    this.root.append(this.glass);

    this.ui = doc.createElement("div");
    this.ui.className = "ui";
    this.root.append(this.ui);
  }

  attach(): void {
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
  }

  detach(): void {
    this.host.remove();
  }

  /** Where the overlay's origin sits in the viewport right now. */
  origin(): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  set glassOn(on: boolean) {
    this.glass.hidden = !on;
  }

  set cursor(css: string) {
    this.glass.style.cursor = css;
  }

  /** Lets hit tests see through the glass for the length of `fn`. */
  through<T>(fn: () => T): T {
    const was = this.glass.style.pointerEvents;
    this.glass.style.pointerEvents = "none";
    try {
      return fn();
    } finally {
      this.glass.style.pointerEvents = was;
    }
  }

  draw(scene: Scene): void {
    const sel = loopsToPath(scene.selection);
    if (scene.mask) {
      const se = this.doc.scrollingElement ?? this.doc.documentElement;
      const o = this.origin();
      const w = Math.max(se.scrollWidth, this.doc.documentElement.clientWidth) + Math.abs(o.x) + 64;
      const h = Math.max(se.scrollHeight, this.doc.documentElement.clientHeight) + Math.abs(o.y) + 64;
      this.maskPath.setAttribute("d", `M-32 -32H${w}V${h}H-32Z` + sel);
    } else this.maskPath.removeAttribute("d");
    setD(this.fillPath, scene.mask ? "" : sel);
    setD(this.antsA, sel);
    setD(this.antsB, sel);
    const pv = loopsToPath(scene.preview);
    setD(this.previewFill, pv);
    setD(this.previewLine, pv);
    this.previewLine.setAttribute("data-mode", scene.previewMode);
    this.previewFill.setAttribute("data-mode", scene.previewMode);

    let shape = "";
    if (scene.shape?.type === "rect") {
      const r = scene.shape.rect;
      shape = `M${r.x0} ${r.y0}H${r.x1}V${r.y1}H${r.x0}Z`;
    } else if (scene.shape?.type === "path") shape = polylineToPath(scene.shape.points, true);
    setD(this.shapeA, shape);
    setD(this.shapeB, shape);

    for (const c of [this.brushA, this.brushB]) {
      if (scene.brush) {
        c.setAttribute("cx", String(scene.brush.at[0]));
        c.setAttribute("cy", String(scene.brush.at[1]));
        c.setAttribute("r", String(Math.max(1, scene.brush.radius - (c === this.brushB ? 1 : 0))));
        c.removeAttribute("display");
      } else c.setAttribute("display", "none");
    }
  }
}

function setD(p: SVGPathElement, d: string): void {
  if (d) {
    if (p.getAttribute("d") !== d) p.setAttribute("d", d);
    p.removeAttribute("display");
  } else {
    p.removeAttribute("d");
    p.setAttribute("display", "none");
  }
}

function hostStyle(z: number): string {
  // Inline and important, so page rules such as `html > *` cannot move or hide the host.
  return [
    "all: initial !important",
    "display: block !important",
    "position: absolute !important",
    "top: 0 !important",
    "left: 0 !important",
    "width: 0 !important",
    "height: 0 !important",
    "margin: 0 !important",
    "padding: 0 !important",
    "border: 0 !important",
    "overflow: visible !important",
    "transform: none !important",
    "pointer-events: none !important",
    `z-index: ${z} !important`,
  ].join(";");
}

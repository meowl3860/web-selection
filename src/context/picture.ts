// Pictures for a model: the picture itself, a copy with the user's paint drawn on it, and a crop
// of the painted part. The pixels come from the element where the page may read them: pictures
// from the same site or sent with CORS, videos, canvases and inline SVG. For the rest, such as
// pictures from other sites, the project can pass its own way to get them; an extension can
// take a screenshot of the tab.

import type { PaintArea, PaintMark } from "../brush.js";

export type PixelSource = CanvasImageSource | Blob | string;
/** A project's own way to get the pixels of an element as it shows on the page. */
export type PixelHook = (el: Element) => PixelSource | null | undefined | Promise<PixelSource | null | undefined>;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixels of a picture, and where they lie on the element, in the element's CSS pixels. */
export interface Pixels {
  source: CanvasImageSource;
  width: number;
  height: number;
  frame: Box;
  photo: boolean;
}

export interface Rendered {
  mediaType: "image/png" | "image/jpeg";
  data: string;
  width: number;
  height: number;
}

/** The pixels of a picture element, or null when the page may not read them. */
export async function pixelsOf(el: Element, size: { width: number; height: number }, hook?: PixelHook): Promise<Pixels | null> {
  // The page's own pixels first; the project's way, such as a screenshot, when it may not read them.
  const own = await pagePixels(el, size);
  if (own || !hook) return own;
  const shot = await hook(el);
  const source = shot ? await toSource(shot) : null;
  return source ? { ...source, frame: { x: 0, y: 0, w: size.width, h: size.height }, photo: true } : null;
}

/** The pixels of a picture element as the page may read them, or null. */
async function pagePixels(el: Element, size: { width: number; height: number }): Promise<Pixels | null> {
  const tag = el.localName;
  if (tag === "img") {
    const img = el as HTMLImageElement;
    if (!img.complete) await loaded(img);
    if (!img.naturalWidth) return null;
    // A picture from another site cannot be read where it is; many sites send it again to anyone
    // who asks with CORS, as Wikimedia and most image services do.
    const source = readable(img) ? img : await corsCopy(img.currentSrc || img.src);
    if (!source) return null;
    return { source, width: img.naturalWidth, height: img.naturalHeight, frame: objectFrame(el, size, img.naturalWidth, img.naturalHeight), photo: isPhoto(img.currentSrc || img.src) };
  }
  if (tag === "video") {
    const v = el as HTMLVideoElement;
    if (v.readyState < 2 || !v.videoWidth || !readable(v)) return null;
    return { source: v, width: v.videoWidth, height: v.videoHeight, frame: objectFrame(el, size, v.videoWidth, v.videoHeight), photo: true };
  }
  if (tag === "canvas") {
    const c = el as HTMLCanvasElement;
    if (!c.width || !c.height || !readable(c)) return null;
    return { source: c, width: c.width, height: c.height, frame: objectFrame(el, size, c.width, c.height), photo: false };
  }
  if (tag === "svg") return svgPixels(el as SVGSVGElement, size);
  return null;
}

/** The picture at a URL loaded again with CORS, if its site allows it; else null. */
async function corsCopy(url: string): Promise<HTMLImageElement | null> {
  if (!url || url.startsWith("data:")) return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  const ok = await new Promise<boolean>((done) => {
    const timer = setTimeout(() => done(false), 5000);
    img.onload = () => {
      clearTimeout(timer);
      done(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(false);
    };
  });
  return ok && readable(img) ? img : null;
}

/**
 * Waits for a picture that is still loading, for a few seconds at most. It waits for the load
 * event rather than calling decode(), which can crash Chrome on a lazy picture not yet loading.
 */
function loaded(img: HTMLImageElement): Promise<void> {
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(finish, 3000);
    img.addEventListener("load", finish, { once: true });
    img.addEventListener("error", finish, { once: true });
  });
}

async function toSource(s: PixelSource): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  try {
    if (typeof s === "string") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = s;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    }
    if (s instanceof Blob) {
      const bmp = await createImageBitmap(s);
      return { source: bmp, width: bmp.width, height: bmp.height };
    }
    const w = "naturalWidth" in s ? s.naturalWidth : "videoWidth" in s ? s.videoWidth : (s as { width: number }).width;
    const h = "naturalHeight" in s ? s.naturalHeight : "videoHeight" in s ? s.videoHeight : (s as { height: number }).height;
    return w && h ? { source: s, width: Number(w), height: Number(h) } : null;
  } catch {
    return null;
  }
}

/** False when the browser keeps the pixels from the page, as for a picture from another site. */
function readable(src: CanvasImageSource): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

function isPhoto(url: string): boolean {
  return /\.(jpe?g|webp|avif|heic)(\?|#|$)/i.test(url);
}

/** The styles an inline SVG takes from the page, which a copy of it on its own would lose. */
const SVG_STYLES = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap",
  "stroke-linejoin", "opacity", "color", "font-family", "font-size", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "visibility", "display",
];

/** Draws an inline SVG on its own, with the page's styles copied onto it, at twice its size. */
async function svgPixels(svg: SVGSVGElement, size: { width: number; height: number }): Promise<Pixels | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    to[i]!.setAttribute("style", SVG_STYLES.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(size.width));
  copy.setAttribute("height", String(size.height));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const k = 2;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(size.width * k));
  c.height = Math.max(1, Math.round(size.height * k));
  const ctx = c.getContext("2d")!;
  // An SVG is often see-through: draw it on the background it shows on.
  ctx.fillStyle = backgroundOf(svg);
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { source: c, width: c.width, height: c.height, frame: { x: 0, y: 0, w: size.width, h: size.height }, photo: false };
}

/** The first solid background colour behind an element, or white. */
function backgroundOf(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    const m = /rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,/]+([\d.]+%?))?/.exec(bg);
    const alpha = m ? (m[1] === undefined ? 1 : m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1])) : 0;
    if (alpha > 0.5) return bg;
  }
  return "#fff";
}

/** Where a picture's pixels lie on its element, following object-fit and object-position. */
export function objectFrame(el: Element, size: { width: number; height: number }, nw: number, nh: number): Box {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const left = px(cs.borderLeftWidth) + px(cs.paddingLeft);
  const top = px(cs.borderTopWidth) + px(cs.paddingTop);
  const cw = size.width - left - px(cs.borderRightWidth) - px(cs.paddingRight);
  const ch = size.height - top - px(cs.borderBottomWidth) - px(cs.paddingBottom);
  return fitBox(cs.objectFit, cs.objectPosition, { x: left, y: top, w: cw, h: ch }, nw, nh);
}

/** Places a picture of `nw` by `nh` pixels in a content box, the way CSS object-fit does. */
export function fitBox(fit: string, position: string, box: Box, nw: number, nh: number): Box {
  if (fit === "fill" || !nw || !nh) return box;
  const contain = Math.min(box.w / nw, box.h / nh);
  const s = fit === "contain" ? contain : fit === "cover" ? Math.max(box.w / nw, box.h / nh) : fit === "scale-down" ? Math.min(1, contain) : 1;
  const w = nw * s, h = nh * s;
  const [px = "50%", py = "50%"] = position.split(/\s+/);
  const at = (v: string, room: number) => (v.endsWith("%") ? (room * parseFloat(v)) / 100 : parseFloat(v) || 0);
  return { x: box.x + at(px, box.w - w), y: box.y + at(py, box.h - h), w, h };
}

/** The part of the element where the picture shows: its pixels, cut to the element's content box. */
export function visibleBox(p: Pixels, size: { width: number; height: number }): Box {
  const x0 = Math.max(0, p.frame.x), y0 = Math.max(0, p.frame.y);
  const x1 = Math.min(size.width, p.frame.x + p.frame.w), y1 = Math.min(size.height, p.frame.y + p.frame.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Scales a size down to fit `max` pixels on its longer side and about 1.15 million pixels in all. */
export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h), Math.sqrt(1_150_000 / (w * h)));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * Draws part of the element, `region` in its CSS pixels, from the picture's pixels, at most
 * `max` pixels on the longer side; with `marks`, the user's paint is drawn over it. A small
 * part is drawn larger, up to `min` pixels on the longer side, so a model can make it out.
 */
export function render(p: Pixels, region: Box, max: number, marks: Marks | null, min = 0): Rendered | null {
  if (region.w < 1 || region.h < 1) return null;
  const sx = p.width / p.frame.w, sy = p.height / p.frame.h;
  const src = { x: (region.x - p.frame.x) * sx, y: (region.y - p.frame.y) * sy, w: region.w * sx, h: region.h * sy };
  const up = Math.min(4, Math.max(1, min / Math.max(src.w, src.h)));
  const out = fitSize(src.w * up, src.h * up, max);
  const c = document.createElement("canvas");
  c.width = out.width;
  c.height = out.height;
  const ctx = c.getContext("2d")!;
  if (!p.photo) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(p.source, src.x, src.y, src.w, src.h, 0, 0, out.width, out.height);
  if (marks) {
    drawPaint(ctx, marks.strokes, marks.color, out.width / region.w, region);
    drawNumbers(ctx, marks.numbers ?? [], marks.color, out.width / region.w, region);
  }
  const mediaType = p.photo ? "image/jpeg" : "image/png";
  const url = c.toDataURL(mediaType, 0.9);
  return { mediaType, data: url.slice(url.indexOf(",") + 1), width: out.width, height: out.height };
}

/** The paint to draw on a picture, and the number of each mark at a point, in the element's CSS pixels. */
export interface Marks {
  strokes: PaintMark[];
  color: string;
  numbers?: { n: number; x: number; y: number }[];
}

/** Draws each mark's number in a round badge, as on the page, kept inside the picture. */
function drawNumbers(ctx: CanvasRenderingContext2D, numbers: { n: number; x: number; y: number }[], color: string, k: number, region: Box): void {
  const { width, height } = ctx.canvas;
  const r = Math.max(11, Math.round(Math.max(width, height) / 60));
  for (const { n, x, y } of numbers) {
    const cx = Math.min(width - r - 2, Math.max(r + 2, (x - region.x) * k));
    const cy = Math.min(height - r - 2, Math.max(r + 2, (y - region.y) * k));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r / 5);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(r * 1.15)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), cx, cy + 1);
  }
}

/**
 * Draws the paint the way a person marks a photo: a see-through fill with a solid edge around
 * it, so the model sees both the place and what is under it.
 */
function drawPaint(ctx: CanvasRenderingContext2D, strokes: PaintMark[], color: string, k: number, region: Box): void {
  const { width, height } = ctx.canvas;
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const m = mask.getContext("2d")!;
  m.setTransform(k, 0, 0, k, -region.x * k, -region.y * k);
  m.lineCap = "round";
  m.lineJoin = "round";
  for (const s of strokes) {
    m.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    m.strokeStyle = m.fillStyle = color;
    m.lineWidth = s.radius * 2;
    m.beginPath();
    const [first, ...rest] = s.points;
    if (!first) continue;
    if (!rest.length) {
      m.arc(first[0], first[1], s.radius, 0, Math.PI * 2);
      m.fill();
      continue;
    }
    m.moveTo(first[0], first[1]);
    for (const q of rest) m.lineTo(q[0], q[1]);
    m.stroke();
  }
  // The edge: the paint grown a little in every direction, less the paint itself. A white rim
  // outside the coloured edge keeps it clear on any background.
  const t = Math.max(2, Math.round(Math.max(width, height) / 300));
  const ring = (grow: number, fill: string) => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const e = c.getContext("2d")!;
    for (let a = 0; a < 24; a++) {
      const r = (a / 24) * Math.PI * 2;
      e.drawImage(mask, Math.cos(r) * grow, Math.sin(r) * grow);
    }
    e.globalCompositeOperation = "source-in";
    e.fillStyle = fill;
    e.fillRect(0, 0, width, height);
    e.globalCompositeOperation = "destination-out";
    e.drawImage(mask, 0, 0);
    return c;
  };
  const rim = ring(t + Math.max(1, t / 2), "#fff");
  const edge = ring(t, color);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.drawImage(mask, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(rim, 0, 0);
  ctx.drawImage(edge, 0, 0);
  ctx.restore();
}

/** The smallest side of a crop, in CSS pixels, so a small mark still shows what is around it. */
const CROP_MIN = 64;

/** The painted part of the element and some room around it, in its CSS pixels. */
export function cropBox(area: PaintArea, visible: Box): Box | null {
  const b = area.box;
  if (!b) return null;
  let x0 = b.x0 * area.width, y0 = b.y0 * area.height, x1 = b.x1 * area.width, y1 = b.y1 * area.height;
  const pad = Math.max(12, 0.2 * Math.max(x1 - x0, y1 - y0));
  x0 -= pad, y0 -= pad, x1 += pad, y1 += pad;
  const growX = Math.max(0, CROP_MIN - (x1 - x0)) / 2, growY = Math.max(0, CROP_MIN - (y1 - y0)) / 2;
  x0 -= growX, x1 += growX, y0 -= growY, y1 += growY;
  const cx0 = Math.max(visible.x, x0), cy0 = Math.max(visible.y, y0);
  const cx1 = Math.min(visible.x + visible.w, x1), cy1 = Math.min(visible.y + visible.h, y1);
  return cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
}

/** The painted box as a share of the visible picture, such as "x 41–58%, y 16–57%". */
export function boxText(area: PaintArea, visible: Box): string | null {
  const b = area.box;
  if (!b || visible.w <= 0 || visible.h <= 0) return null;
  const pct = (v: number, o: number, len: number) => Math.round(Math.max(0, Math.min(1, (v - o) / len)) * 100);
  const x0 = pct(b.x0 * area.width, visible.x, visible.w), x1 = pct(b.x1 * area.width, visible.x, visible.w);
  const y0 = pct(b.y0 * area.height, visible.y, visible.h), y1 = pct(b.y1 * area.height, visible.y, visible.h);
  return `x ${x0}–${x1}%, y ${y0}–${y1}% (from the top left)`;
}

/** A short name for a picture: its alt text, label, title or caption, else its file name. */
export function pictureName(el: Element): string {
  const attr = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title");
  if (attr?.trim()) return attr.trim();
  if (el.localName === "svg") {
    const t = el.querySelector("title")?.textContent?.trim();
    if (t) return t;
  }
  const cap = el.closest("figure")?.querySelector("figcaption")?.textContent?.replace(/\s+/g, " ").trim();
  if (cap) return cap;
  const src = (el as HTMLImageElement).currentSrc || el.getAttribute("src") || (el as HTMLVideoElement).poster || "";
  const file = src.split(/[?#]/)[0]!.split("/").pop();
  if (file) {
    try {
      return decodeURIComponent(file);
    } catch {
      return file;
    }
  }
  return "";
}

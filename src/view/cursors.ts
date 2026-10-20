// Pointer images for each tool. Like Photoshop, a small sign next to the pointer shows what a
// click will do: + adds, − subtracts, × intersects. Each shape has a white halo so it stays
// visible on light and dark pages.

import type { Mode } from "../core/intervals.js";

export type Tool = "smart" | "wand" | "marquee" | "lasso" | "brush" | "text";

function glyph(mode: Mode, x: number, y: number): string {
  const h = 2.6;
  switch (mode) {
    case "add":
      return `M${x - h} ${y}H${x + h}M${x} ${y - h}V${y + h}`;
    case "subtract":
      return `M${x - h} ${y}H${x + h}`;
    case "intersect":
      return `M${x - h} ${y - h}L${x + h} ${y + h}M${x + h} ${y - h}L${x - h} ${y + h}`;
    default:
      return "";
  }
}

function cursor(body: string, mode: Mode, gx: number, gy: number, hx: number, hy: number, fallback: string): string {
  const d = glyph(mode, gx, gy);
  const marks = d
    ? `<path d="${d}" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="${d}" stroke="#111" stroke-width="1.4" stroke-linecap="round"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">${body}${marks}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}

function haloed(d: string, extra = ""): string {
  return `<path d="${d}" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"${extra}/>` +
    `<path d="${d}" stroke="#111" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

const SMART = '<path d="M3 2.5V15.5L6.4 12.3L8.7 17.3L10.8 16.4L8.5 11.5L13 11.2Z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>' +
  haloed("M14 14H21V21H14Z", ' stroke-dasharray="2 1.7"');
const WAND = haloed("M9.5 9.5L20 20") + haloed("M5 1.8V4.2M5 5.8V8.2M1.8 5H4.2M5.8 5H8.2M2.7 2.7L3.6 3.6M6.4 6.4L7.3 7.3M7.3 2.7L6.4 3.6");
const CROSS = haloed("M11 3V9M11 13V19M3 11H9M13 11H19");
const LASSO = haloed("M7 15.5C3.5 14.6 2.2 12.3 3.6 9.6C5.4 6 12.5 4.6 17.4 6.6C21.5 8.3 21 12.6 15.6 14.4C12.9 15.3 9.8 15.6 7 15.5ZM7 15.5C6 17 5.2 19 4.6 21.4");

export function cursorFor(tool: Tool, mode: Mode): string {
  switch (tool) {
    case "smart":
      return cursor(SMART, mode, 18.5, 5.5, 3, 2, "default");
    case "wand":
      return cursor(WAND, mode, 18.5, 5.5, 5, 5, "crosshair");
    case "marquee":
      return cursor(CROSS, mode, 18.5, 18.5, 11, 11, "crosshair");
    case "lasso":
      return cursor(LASSO, mode, 18.5, 19, 5, 21, "crosshair");
    case "brush":
      return cursor(CROSS, mode, 18.5, 18.5, 11, 11, "crosshair");
    case "text":
      return "text";
  }
}

// The brush: paint over a web page to select its elements. Turning a selection into context for
// an AI model lives in its own entry point, "web-selection/context".
export { createBrush } from "./brush.js";
export type { Brush, BrushEvents, BrushOptions, ItemMark, Mark, PaintArea, PaintMark, SelectedItem } from "./brush.js";
export type { ShadowOf } from "./dom.js";
export type { TargetKind } from "./targets.js";

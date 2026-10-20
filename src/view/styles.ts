// Styles live in the overlay's shadow root. Colours follow the system light or dark setting,
// since the page under the overlay can be either.

export const overlayCss = /* css */ `
:host {
  --ws-surface: #ffffff;
  --ws-surface-2: #f5f6fa;
  --ws-line: #d5d9e7;
  --ws-fg: #171a2c;
  --ws-muted: #5a6079;
  --ws-accent: #4048c9;
  --ws-accent-soft: #e4e6fb;
  --ws-on-accent: #ffffff;
  --ws-hover: #eef0f6;
  --ws-warn: #a8321f;
  --ws-shadow: 0 1px 2px rgba(10, 12, 24, 0.08), 0 8px 28px rgba(10, 12, 24, 0.16);
  /* Drawn over any page, so these stay the same in both themes. */
  --ws-sel-fill: rgba(64, 72, 201, 0.12);
  --ws-preview: #4a57e8;
  --ws-preview-fill: rgba(74, 87, 232, 0.1);
  --ws-cut: #d23c2a;
  --ws-cut-fill: rgba(210, 60, 42, 0.1);
  --ws-mask: rgba(225, 29, 42, 0.38);
  --ws-font: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :host {
    --ws-surface: #161a2e;
    --ws-surface-2: #1c2138;
    --ws-line: #2b3150;
    --ws-fg: #e7e9f5;
    --ws-muted: #9aa0bd;
    --ws-accent: #9ea4ff;
    --ws-accent-soft: #232750;
    --ws-on-accent: #0e1120;
    --ws-hover: #1e2340;
    --ws-warn: #ff9a86;
    --ws-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 32px rgba(0, 0, 0, 0.45);
  }
}

.layer {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
.layer path, .layer circle { fill: none; }
.mask { fill: var(--ws-mask) !important; fill-rule: evenodd; shape-rendering: crispEdges; }
.fill { fill: var(--ws-sel-fill) !important; fill-rule: evenodd; shape-rendering: crispEdges; }
.ants-a { stroke: #111; stroke-width: 1; shape-rendering: crispEdges; }
.ants-b {
  stroke: #fff;
  stroke-width: 1;
  stroke-dasharray: 4 4;
  shape-rendering: crispEdges;
  animation: ws-march 0.64s steps(8) infinite;
}
@keyframes ws-march { to { stroke-dashoffset: -8; } }
@media (prefers-reduced-motion: reduce) { .ants-b { animation: none; } }
.preview-fill { fill: var(--ws-preview-fill) !important; fill-rule: evenodd; shape-rendering: crispEdges; }
.preview-line { stroke: var(--ws-preview); stroke-width: 2; shape-rendering: crispEdges; }
.preview-fill[data-mode="subtract"] { fill: var(--ws-cut-fill) !important; }
.preview-line[data-mode="subtract"] { stroke: var(--ws-cut); stroke-dasharray: 6 3; }
.preview-line[data-mode="intersect"] { stroke-dasharray: 6 3; }
.brush-a { stroke: #111; stroke-width: 1; }
.brush-b { stroke: #fff; stroke-width: 1; }

.glass {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  background: transparent;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.glass[hidden] { display: none; }

.ui {
  font: 400 13px/1.4 var(--ws-font);
  color: var(--ws-fg);
  -webkit-font-smoothing: antialiased;
}
.ui *, .ui *::before, .ui *::after { box-sizing: border-box; }

.bar {
  position: fixed;
  z-index: 1;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: grid;
  gap: 6px;
  width: max-content;
  max-width: calc(100vw - 32px);
  padding: 8px 10px;
  background: var(--ws-surface);
  border: 1px solid var(--ws-line);
  border-radius: 12px;
  box-shadow: var(--ws-shadow);
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}
.bar[hidden] { display: none; }
.bar.placed { transform: none; bottom: auto; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 32px; }
.sep { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--ws-line); }
.group { display: flex; align-items: center; gap: 2px; }
.spacer { flex: 1 1 auto; min-width: 8px; }

button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  min-width: 32px;
  padding: 0 8px;
  border-radius: 7px;
  color: var(--ws-fg);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
button:hover { background: var(--ws-hover); }
button:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 1px; }
button[disabled] { opacity: 0.45; cursor: default; background: none; }
button.icon { width: 32px; padding: 0; }
button.icon svg { width: 20px; height: 20px; }
button[aria-pressed="true"] { background: var(--ws-accent-soft); color: var(--ws-accent); }
.modes button.icon { width: 28px; min-width: 28px; height: 28px; }
.modes button.icon svg { width: 16px; height: 16px; }
.cmds button { color: var(--ws-fg); padding: 0 9px; }
.grip {
  width: 16px;
  min-width: 16px;
  padding: 0;
  cursor: grab;
  color: var(--ws-muted);
}
.grip:hover { background: none; color: var(--ws-fg); }
.grip:active { cursor: grabbing; }
.grip svg { width: 8px; height: 16px; }

.seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; background: var(--ws-surface-2); border: 1px solid var(--ws-line); }
.seg button { height: 26px; min-width: 0; padding: 0 10px; border-radius: 6px; color: var(--ws-muted); }
.seg button[aria-pressed="true"] { background: var(--ws-surface); color: var(--ws-fg); box-shadow: 0 1px 2px rgba(10, 12, 24, 0.12); }

.opts { display: flex; align-items: center; gap: 10px; width: 312px; padding: 0 4px; }
.opts[hidden] { display: none; }
.opt-label { color: var(--ws-muted); }
.num {
  min-width: 2.6ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ws-fg);
}
.hint { color: var(--ws-muted); }

input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 112px;
  height: 20px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
input[type="range"]:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; border-radius: 4px; }
input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--ws-accent) 0 var(--fill, 50%), var(--ws-line) var(--fill, 50%) 100%);
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--ws-surface);
  border: 2px solid var(--ws-accent);
}
input[type="range"]::-moz-range-track { height: 4px; border-radius: 2px; background: var(--ws-line); }
input[type="range"]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--ws-accent); }
input[type="range"]::-moz-range-thumb { width: 10px; height: 10px; border-radius: 50%; background: var(--ws-surface); border: 2px solid var(--ws-accent); }

label.check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
input[type="checkbox"] {
  -webkit-appearance: none;
  appearance: none;
  display: inline-grid;
  place-content: center;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1.5px solid var(--ws-muted);
  border-radius: 4px;
  background: var(--ws-surface);
  cursor: pointer;
}
input[type="checkbox"]:checked { background: var(--ws-accent); border-color: var(--ws-accent); }
input[type="checkbox"]:checked::after {
  content: "";
  width: 8px;
  height: 4.5px;
  margin-top: -2px;
  border-left: 2px solid var(--ws-on-accent);
  border-bottom: 2px solid var(--ws-on-accent);
  transform: rotate(-45deg);
}
input[type="checkbox"]:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }

.status {
  color: var(--ws-muted);
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  white-space: nowrap;
}
.done {
  background: var(--ws-accent);
  color: var(--ws-on-accent);
  padding: 0 14px;
  font-weight: 600;
}
.done:hover { background: var(--ws-accent); filter: brightness(1.08); }

.tip {
  position: fixed;
  z-index: 2;
  max-width: 260px;
  padding: 6px 9px;
  border-radius: 7px;
  background: #171a2c;
  color: #f2f3fa;
  font: 400 12.5px/1.4 var(--ws-font);
  box-shadow: 0 4px 16px rgba(10, 12, 24, 0.25);
  pointer-events: none;
}
.tip[hidden] { display: none; }
.tip b { font-weight: 600; }
.tip kbd {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  font: 500 11.5px/1.5 var(--ws-font);
}
.tip span { display: block; margin-top: 2px; color: #c4c7da; }
@media (prefers-color-scheme: dark) {
  .tip { background: #e7e9f5; color: #171a2c; }
  .tip kbd { background: rgba(10, 12, 24, 0.1); }
  .tip span { color: #4a5068; }
}
`;

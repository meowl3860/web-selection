// Styles live in the overlay's shadow root, so page styles cannot reach them and they cannot
// reach the page. The paint and the hover outline sit on top of whatever the page is, so they
// show stronger on a dark page.

export const PAINT_COLOR = "#4b57f0";

export const css = /* css */ `
:host {
  --ws-paint-opacity: 0.32;
  --ws-near: #3f4ae0;
  --ws-hud-bg: rgba(23, 26, 44, 0.92);
  --ws-hud-fg: #f2f3fa;
  --ws-hud-muted: #a9aecb;
  --ws-font: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
}
/* On a dark page the paint shows stronger and the outline lighter, so both stay easy to see. */
:host([data-dark-page]) {
  --ws-paint-opacity: 0.5;
  --ws-near: #8f99ff;
}

/* The selected text, drawn again with its letters jittering. */
.jitter {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}

.paint {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
  opacity: var(--ws-paint-opacity);
  pointer-events: none;
}

/* Paint on a fixed bar, such as a site header, stays on the screen with the bar. */
.screen-paint {
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
  opacity: var(--ws-paint-opacity);
  pointer-events: none;
}

.marks,
.screen-marks {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
.screen-marks { position: fixed; }
.marks path, .screen-marks path { fill: none; stroke-linejoin: miter; }
.near { stroke: var(--ws-near); stroke-width: 1; stroke-dasharray: 4 3; opacity: 0.85; }
/* The number of each mark, at the top left of its paint. */
.badge circle { fill: var(--ws-paint, ${PAINT_COLOR}); stroke: #fff; stroke-width: 2; }
.badge text { fill: #fff; font: 700 11px/1 var(--ws-font); text-anchor: middle; dominant-baseline: central; }

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

.hud {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px 7px 12px;
  border-radius: 999px;
  background: var(--ws-hud-bg);
  color: var(--ws-hud-fg);
  font: 400 13px/1.3 var(--ws-font);
  -webkit-font-smoothing: antialiased;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 6px 24px rgba(10, 12, 24, 0.25);
  white-space: nowrap;
  pointer-events: none;
}
.hud[hidden] { display: none; }
.hud .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ws-paint, ${PAINT_COLOR});
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85);
}
.hud .count { font-variant-numeric: tabular-nums; }
.hud .keys { color: var(--ws-hud-muted); }
`;

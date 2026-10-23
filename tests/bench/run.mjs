// The benchmark: the brush on real sites, used the way a person uses it, with real mouse input.
// On each site it touches a paragraph, paints along a phrase, sweeps down until the page
// scrolls by itself, scribbles over a picture, erases, removes a stroke with right-click, undoes
// and redoes, writes two notes, scrolls with the wheel, and builds the context for a model.
// The brush's own handlers are timed, so the site's own work does not count against it.
// Writes tests/bench/RESULTS.md, and tests/bench/results/<time>/report.html with a screenshot
// of each site. Build first (npm run build).
//
//   node tests/bench/run.mjs                    every site
//   node tests/bench/run.mjs --sites mdn,bbc    some sites

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";
import { SITES } from "./sites.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]] : [])));
const sites = args.sites ? SITES.filter((s) => String(args.sites).split(",").includes(s.name)) : SITES;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join(HERE, "results", stamp);
mkdirSync(OUT, { recursive: true });

/**
 * The limits of the RAIL model: continuous work, such as a move, a scroll or a frame, must fit
 * in one frame at 60 Hz; the answer to a single click or key may take up to 50 ms.
 */
const FRAME = 16.7;
const RESPONSE = 50;
const CONTINUOUS = ["pointerMove", "scrolled", "render", "jitterDraw", "jitterMeasure"];
const DISCRETE = ["pointerDown", "pointerUp", "keyDown", "wheel", "applyLooks"];

// The extension's content script, and toContext as one classic script for any page.
await build({
  configFile: false,
  logLevel: "warn",
  build: { outDir: OUT, emptyOutDir: false, minify: false, lib: { entry: join(ROOT, "src/context/index.ts"), formats: ["iife"], name: "WSContext", fileName: () => "context.js" } },
});
const CONTENT = readFileSync(join(ROOT, "extension/content.js"), "utf8") + "\n//# sourceURL=web-selection/content.js";
const CONTEXT = readFileSync(join(OUT, "context.js"), "utf8") + "\n//# sourceURL=web-selection/context.js";

/** Times the brush's handlers and watches for long tasks, in the page. */
const INSTRUMENT = `(() => {
  const bench = (window.__bench = { t: {}, longtasks: [] });
  const wrap = (obj, name, key) => {
    const f = obj[name];
    obj[name] = function (...a) {
      const s = performance.now();
      try { return f.apply(this, a); } finally { (bench.t[key] ??= []).push(performance.now() - s); }
    };
  };
  const b = window.webSelection;
  for (const n of ["pointerDown", "pointerMove", "pointerUp", "keyDown", "wheel", "scrolled", "render", "applyLooks"]) wrap(b, n, n);
  wrap(b.jitter, "draw", "jitterDraw");
  wrap(b.jitter, "measure", "jitterMeasure");
  new PerformanceObserver((l) => { for (const e of l.getEntries()) bench.longtasks.push(e.duration); }).observe({ type: "longtask" });
})()`;

/** Finds a block of text to paint on and puts it in the middle of the screen. */
const FIND_TEXT = () => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join("").replace(/\s+/g, " ").trim().length;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 250 && r.height > 12 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  };
  const aside = (el) => el.closest("header, nav, footer, aside, [role=navigation], [role=banner], [role=dialog]");
  const all = [...document.querySelectorAll("p, li, td, dd, blockquote, div, span, h2, h3")];
  const el = all.find((e) => own(e) >= 80 && shown(e) && !aside(e)) ?? all.find((e) => own(e) >= 30 && shown(e) && !aside(e));
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: Math.min(r.width, 900), h: r.height };
};

/** Finds a big picture and puts it in the middle of the screen. */
const FIND_PICTURE = () => {
  const el = [...document.querySelectorAll("img, svg, video, canvas")].find((e) => {
    const r = e.getBoundingClientRect();
    return r.width >= 200 && r.height >= 120 && (!e.checkVisibility || e.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  });
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * Where some elements sit on the page, to see whether anything moved: the same elements each
 * time, measured from the top of the page with the page scrolled to the top. Fixed and sticky
 * boxes move as the page scrolls, so they are left out.
 */
const LAYOUT = async () => {
  scrollTo(0, 0);
  // Let the page settle what it draws at this scroll position, such as lazily drawn sections.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pinned = (e) => {
    for (let a = e; a; a = a.parentElement) if (/fixed|sticky/.test(getComputedStyle(a).position)) return true;
    return false;
  };
  window.__layoutEls ??= [...document.querySelectorAll("p, li, h2, h3, img, table")].filter((e) => e.getBoundingClientRect().height > 0 && !pinned(e)).filter((_, i) => i % 7 === 0).slice(0, 40);
  return {
    height: document.documentElement.scrollHeight,
    // A tilted picture's box is a little bigger than the picture; it does not count as a move.
    boxes: window.__layoutEls.map((e) => {
      const r = e.getBoundingClientRect();
      return e.closest("[data-ws-look=pinned]") ? [0, 0] : [Math.round((r.top + scrollY) * 10) / 10, Math.round(r.height * 10) / 10];
    }),
  };
};

async function drag(page, points, steps = 12) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps });
  if (points.length === 1) await page.mouse.move(points[0][0] + 0.5, points[0][1]);
  await page.mouse.up();
}

async function session(page) {
  const steps = [];
  const step = (name) => steps.push(name);
  const text = await page.evaluate(FIND_TEXT);
  await page.waitForTimeout(300);
  if (text) {
    const lineY = text.y + Math.min(text.h, 40) / 2;
    step("touch");
    await drag(page, [[text.x + text.w * 0.5, lineY]]);
    step("phrase");
    await drag(page, [[text.x + 20, lineY], [text.x + text.w * 0.6, lineY]], 20);
    step("sweep and autoscroll");
    await page.mouse.move(text.x + 40, text.y + 10);
    await page.mouse.down();
    await page.mouse.move(text.x + 80, Math.min(860, text.y + 420), { steps: 30 });
    await page.mouse.move(text.x + 80, 896, { steps: 5 });
    await page.waitForTimeout(800);
    await page.mouse.up();
  }
  const pic = await page.evaluate(FIND_PICTURE);
  await page.waitForTimeout(300);
  if (pic) {
    step("scribble on a picture");
    await drag(page, [[pic.x + pic.w * 0.3, pic.y + pic.h * 0.35], [pic.x + pic.w * 0.6, pic.y + pic.h * 0.6], [pic.x + pic.w * 0.35, pic.y + pic.h * 0.65]], 10);
    step("right-click a stroke");
    await page.mouse.click(pic.x + pic.w * 0.45, pic.y + pic.h * 0.475, { button: "right" });
  }
  step("erase");
  await page.keyboard.down("Alt");
  await drag(page, [[400, 450], [800, 460]], 15);
  await page.keyboard.up("Alt");
  step("undo and redo");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  step("two marks with notes");
  await page.evaluate(() => {
    const m = window.webSelection.marks();
    if (m.length) window.webSelection.note(m[m.length - 1].id, "What does this mean?");
  });
  const again = await page.evaluate(FIND_TEXT);
  if (again) await drag(page, [[again.x + 30, again.y + 10], [again.x + again.w * 0.5, again.y + 12]], 15);
  await page.evaluate(() => {
    const m = window.webSelection.marks();
    if (m.length) window.webSelection.note(m[m.length - 1].id, "Make this shorter.");
  });
  step("scroll with the wheel");
  await page.mouse.move(640, 450);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(250);
  }
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(1000);
  return steps;
}

const stats = (xs = []) => {
  const v = [...xs].sort((a, b) => a - b);
  const at = (q) => (v.length ? v[Math.min(v.length - 1, Math.floor(v.length * q))] : 0);
  return { n: v.length, p50: at(0.5), p95: at(0.95), max: v.length ? v[v.length - 1] : 0, sum: v.reduce((a, b) => a + b, 0) };
};

const browser = await chromium.launch({ channel: "chrome" });
const cdp = await browser.newBrowserCDPSession();
const userAgent = (await cdp.send("Browser.getVersion")).userAgent.replace("HeadlessChrome", "Chrome");
const rows = [];
for (const site of sites) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, userAgent, bypassCSP: true, reducedMotion: "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push({ ours: /web-selection\//.test(e.stack ?? ""), message: e.message.slice(0, 160) }));
  const row = { site: site.name, kind: site.kind, url: site.url };
  try {
    await page.goto(site.url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    // A bot check can load the page a second time; wait for it to settle.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.evaluate(CONTENT);
    await page.evaluate(CONTEXT);
    await page.evaluate(INSTRUMENT);
    row.enable = await page.evaluate(() => {
      const s = performance.now();
      window.webSelection.enable();
      return performance.now() - s;
    });
    row.steps = await session(page);
    const result = await page.evaluate(async () => {
      const b = window.webSelection;
      let s = performance.now();
      const items = b.items();
      const itemsMs = performance.now() - s;
      s = performance.now();
      const ctx = await window.WSContext.toContext(items);
      const contextMs = performance.now() - s;
      return {
        t: window.__bench.t,
        longtasks: window.__bench.longtasks,
        selected: items.length,
        marks: b.marks().length,
        targets: b.targets.length,
        nodes: document.getElementsByTagName("*").length,
        itemsMs,
        contextMs,
        tokens: ctx.tokens,
        pictures: ctx.parts.filter((p) => p.type === "image").length,
      };
    });
    await page.screenshot({ path: join(OUT, `${site.name}.png`) });
    // The look must not move anything: compare the page with it and, a moment later, without it.
    // Sites that keep loading can move by themselves, so the two are taken close together.
    const before = await page.evaluate(LAYOUT);
    await page.evaluate(() => window.webSelection.destroy());
    const after = await page.evaluate(LAYOUT);
    // An element the page is not drawing at that moment has no size: it cannot be compared.
    const moved = Math.max(0, ...before.boxes.map(([top, h], i) => {
      const [top2, h2] = after.boxes[i] ?? [top, h];
      return h > 0 && h2 > 0 ? Math.max(Math.abs(top2 - top), Math.abs(h2 - h)) : 0;
    }));
    const grew = before.height - after.height;
    const t = result.t;
    const handlers = ["pointerDown", "pointerMove", "pointerUp", "keyDown", "wheel", "scrolled", "applyLooks"].flatMap((k) => t[k] ?? []);
    Object.assign(row, {
      nodes: result.nodes,
      targets: result.targets,
      selected: result.selected,
      marks: result.marks,
      move: stats(t.pointerMove),
      handler: stats(handlers),
      frame: stats(t.render),
      jitterDraw: stats(t.jitterDraw),
      jitterMeasure: stats(t.jitterMeasure),
      longtasks: stats(result.longtasks),
      items: result.itemsMs,
      context: result.contextMs,
      tokens: result.tokens,
      pictures: result.pictures,
      moved: Math.round(moved * 10) / 10,
      grew,
      worst: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.max(...v)]).sort((a, b) => b[1] - a[1])),
      ourErrors: errors.filter((e) => e.ours).map((e) => e.message),
      siteErrors: errors.filter((e) => !e.ours).length,
    });
    row.continuous = Math.max(0, ...CONTINUOUS.flatMap((k) => t[k] ?? []));
    row.discrete = Math.max(0, ...DISCRETE.flatMap((k) => t[k] ?? []));
    row.smooth = row.continuous < FRAME && row.discrete < RESPONSE;
  } catch (err) {
    row.failed = String(err.message ?? err).split("\n")[0].slice(0, 200);
  }
  rows.push(row);
  console.log(row.failed ? `${site.name}: failed: ${row.failed}` : `${site.name}: worst ${Object.entries(row.worst).slice(0, 2).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ")} ms; jitter p95 ${row.jitterDraw.p95.toFixed(1)} ms; moved ${row.moved} px; page grew ${row.grew} px; our errors ${row.ourErrors.length}`);
  await context.close();
}
await browser.close();

/* ---------- report ---------- */

const ms = (v) => (v === undefined ? "-" : v < 10 ? v.toFixed(1) : Math.round(v).toString());
writeFileSync(join(OUT, "results.json"), JSON.stringify(rows, null, 1));
const ok = rows.filter((r) => !r.failed);
const lines = [
  "# Benchmark results",
  "",
  "<!-- Written by tests/bench/run.mjs. Run it again rather than editing this file. -->",
  "",
  `Run on ${new Date().toISOString().slice(0, 10)} in Chrome, 1280 × 900, on ${sites.length} real sites; ${ok.length} ran, ${rows.length - ok.length} could not load.`,
  "Each site gets the same session with real mouse input: a touch, a phrase, a sweep that scrolls the page, a scribble on a picture, a right-click, erasing, undo and redo, two notes, and wheel scrolling.",
  `Times are the brush's own work in milliseconds. Smooth means the RAIL limits: continuous work (a move, a scroll, a frame, the jitter) within one frame at 60 Hz, ${FRAME} ms, and the answer to a single click or key within ${RESPONSE} ms.`,
  "",
  "| Site | Kind | Elements | Selected | Move p95 | Worst continuous | Worst click or key | Slowest part | Jitter draw p95 | Items | Context | Tokens | Moved px | Our errors | Smooth |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) =>
    r.failed
      ? `| ${r.site} | ${r.kind} | could not load: ${r.failed.replace(/\|/g, "/")} ||||||||||||`
      : `| ${r.site} | ${r.kind} | ${r.targets} | ${r.selected} | ${ms(r.move.p95)} | ${ms(r.continuous)} | ${ms(r.discrete)} | ${Object.keys(r.worst)[0]} | ${ms(r.jitterDraw.p95)} | ${ms(r.items)} | ${ms(r.context)} | ${r.tokens} | ${r.moved} | ${r.ourErrors.length} | ${r.smooth ? "yes" : "**no**"} |`,
  ),
  "",
];
const errs = ok.filter((r) => r.ourErrors.length);
if (errs.length) lines.push("## Errors from the brush", "", ...errs.flatMap((r) => r.ourErrors.map((m) => `- ${r.site}: ${m}`)), "");
// A run of some sites only writes its own report, not RESULTS.md.
writeFileSync(join(args.sites ? OUT : HERE, "RESULTS.md"), lines.join("\n"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
writeFileSync(
  join(OUT, "report.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Benchmark results</title>
<style>
:root { --bg: #f6f7fb; --fg: #1b1f2e; --muted: #5d6479; --card: #fff; --line: #e2e5ee; --bad: #c53030; }
@media (prefers-color-scheme: dark) { :root { --bg: #12141c; --fg: #e7e9f2; --muted: #9ea4bb; --card: #1a1d29; --line: #2b2f42; --bad: #f07070; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; } th:first-child, td:first-child { text-align: left; }
.bad { color: var(--bad); font-weight: 600; } .muted { color: var(--muted); }
section { background: var(--card); border: 1px solid var(--line); margin: 16px 0; padding: 8px 16px 16px; }
img { max-width: 100%; border: 1px solid var(--line); }
</style></head><body><main><h1>Benchmark results</h1>
<p class="muted">${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} · Chrome 1280 × 900 · times in ms, one frame is ${FRAME} ms</p>
<table><thead><tr><th>Site</th><th>Selected</th><th>Move p95</th><th>Worst handler</th><th>Worst frame</th><th>Jitter p95</th><th>Context</th><th>Moved</th><th>Errors</th></tr></thead><tbody>
${rows.map((r) => (r.failed ? `<tr><td>${esc(r.site)}</td><td colspan="8" class="muted">could not load</td></tr>` : `<tr><td>${esc(r.site)}</td><td>${r.selected}</td><td>${ms(r.move.p95)}</td><td class="${r.handler.max >= FRAME ? "bad" : ""}">${ms(r.handler.max)}</td><td class="${r.frame.max >= FRAME ? "bad" : ""}">${ms(r.frame.max)}</td><td>${ms(r.jitterDraw.p95)}</td><td>${ms(r.context)}</td><td class="${r.moved ? "bad" : ""}">${r.moved}</td><td class="${r.ourErrors.length ? "bad" : ""}">${r.ourErrors.length}</td></tr>`)).join("")}
</tbody></table>
${ok.map((r) => `<section><h2>${esc(r.site)} <span class="muted">${esc(r.kind)}</span></h2><p class="muted">${esc(r.url)}</p><img src="${esc(r.site)}.png" alt=""></section>`).join("")}
</main></body></html>`,
);
console.log(`Report: ${join(OUT, "report.html")}`);

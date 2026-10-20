// Tries the tools on real sites: loads the script build into each page, times the index,
// clicks the wand on the main text's first paragraph, runs Main text, and saves screenshots.
// Usage: node scripts/real.mjs outDir [--scheme dark] [--only name]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SITES = [
  ["mdn", "https://developer.mozilla.org/en-US/docs/Web/API/Range"],
  ["wikipedia", "https://en.wikipedia.org/wiki/Frame_rate"],
  ["unreal", "https://dev.epicgames.com/documentation/en-us/unreal-engine/stat-commands-in-unreal-engine"],
  ["unity", "https://docs.unity3d.com/Manual/ProfilerWindow.html"],
  ["japanese", "https://ja.wikipedia.org/wiki/%E3%83%95%E3%83%AC%E3%83%BC%E3%83%A0%E3%83%AC%E3%83%BC%E3%83%88"],
  ["github", "https://github.com/mozilla/readability"],
];

const args = process.argv.slice(2);
const out = args[0] ?? "real-shots";
const scheme = args.includes("--scheme") ? args[args.indexOf("--scheme") + 1] : "light";
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
for (const [name, url] of SITES) {
  if (only && name !== only) continue;
  // Some sites turn headless browsers away, so send the user agent of a normal Chrome.
  const userAgent = (await browser.newBrowserCDPSession().then((s) => s.send("Browser.getVersion"))).userAgent.replace("HeadlessChrome", "Chrome");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true, deviceScaleFactor: 1, userAgent });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.addScriptTag({ path: "extension/web-selection.js" });
    const t0 = await page.evaluate(() => {
      const t = performance.now();
      window.webSelection.enable();
      return performance.now() - t;
    });
    // The first paragraph of the main text, found by the tool itself.
    const target = await page.evaluate(() => {
      const ws = window.webSelection;
      ws.run("mainText");
      const s = ws.selection;
      const stats = s.stats;
      const p = s.parts.find((x) => x.kind === "paragraph" && x.text.length > 80) ?? s.parts.find((x) => x.text.length > 80);
      ws.run("deselect");
      if (!p) return { stats };
      p.block.scrollIntoView({ block: "center" });
      return { stats, tag: p.block.localName };
    });
    await page.waitForTimeout(300);
    let wand = null;
    if (target.tag) {
      const box = await page.evaluate(() => {
        const ws = window.webSelection;
        ws.run("mainText");
        const p = ws.selection.parts.find((x) => x.kind === "paragraph" && x.text.length > 80) ?? ws.selection.parts.find((x) => x.text.length > 80);
        ws.run("deselect");
        const r = p.block.getBoundingClientRect();
        return { x: r.left + Math.min(r.width / 2, 200), y: r.top + 10 };
      });
      await page.mouse.move(box.x, box.y);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `${name}-hover.png`) });
      await page.mouse.click(box.x, box.y);
      await page.mouse.move(8, 450);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(out, `${name}-wand.png`) });
      wand = await page.evaluate(() => {
        const s = window.webSelection.selection;
        return { stats: s.stats, start: s.text().slice(0, 90) };
      });
    }
    await page.evaluate(() => window.webSelection.run("mainText"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(out, `${name}-main.png`) });
    const timing = await page.evaluate(() => {
      const ws = window.webSelection;
      const t = performance.now();
      ws.disable();
      ws.enable();
      ws.run("selectAll");
      return { selectAll: Math.round(performance.now() - t), words: ws.selection.stats.words };
    });
    console.log(JSON.stringify({ name, enableMs: Math.round(t0), main: target.stats, wand, timing, errors: errors.slice(0, 3) }));
  } catch (err) {
    console.log(JSON.stringify({ name, failed: String(err.message ?? err).slice(0, 200), errors }));
  }
  await context.close();
}
await browser.close();

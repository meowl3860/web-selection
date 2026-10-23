// Tries the brush on real sites: loads the content script into each page, paints a stroke down
// through the article, scrolls so the paint passes under the site's header, and saves
// screenshots. Build first (npm run build).
// Usage: node scripts/real.mjs outDir [--only name] [--scheme dark]
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
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const scheme = args.includes("--scheme") ? args[args.indexOf("--scheme") + 1] : "light";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
// Some sites turn headless browsers away, so send the user agent of a normal Chrome.
const cdp = await browser.newBrowserCDPSession();
const userAgent = (await cdp.send("Browser.getVersion")).userAgent.replace("HeadlessChrome", "Chrome");
for (const [name, url] of SITES) {
  if (only && name !== only) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true, deviceScaleFactor: 1, userAgent });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.addScriptTag({ path: "extension/content.js" });
    const enableMs = await page.evaluate(() => {
      const t = performance.now();
      window.webSelection.enable();
      return Math.round(performance.now() - t);
    });
    // Aim at the first long paragraph on the page.
    const start = await page.evaluate(() => {
      const p = [...document.querySelectorAll("p")].find((el) => (el.textContent ?? "").trim().length > 120 && el.getBoundingClientRect().width > 300);
      if (!p) return null;
      p.scrollIntoView({ block: "center" });
      const r = p.getBoundingClientRect();
      return { x: r.left + Math.min(120, r.width / 3), y: r.top + 8 };
    });
    await page.waitForTimeout(300);
    let result = null;
    if (start) {
      await page.mouse.move(start.x, start.y);
      await page.waitForTimeout(100);
      await page.screenshot({ path: join(out, `${name}-hover.png`) });
      // Where the page's content sits below the stroke, to see that the look moved nothing.
      const below = () =>
        page.evaluate(() => {
          const ps = [...document.querySelectorAll("p, li, h2, h3, td")];
          const r = ps.map((el) => el.getBoundingClientRect()).filter((b) => b.top > innerHeight * 0.9).slice(0, 5);
          return { tops: r.map((b) => Math.round(b.top * 10) / 10), height: document.scrollingElement.scrollHeight };
        });
      const before = await below();
      await page.mouse.down();
      await page.mouse.move(start.x + 60, start.y + 120, { steps: 10 });
      await page.mouse.move(start.x + 20, start.y + 260, { steps: 10 });
      await page.mouse.up();
      const after = await below();
      var moved = Math.max(Math.abs(after.height - before.height), ...before.tops.map((t, i) => Math.abs((after.tops[i] ?? t) - t)));
      await page.mouse.move(8, 450);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `${name}-painted.png`) });
      result = await page.evaluate(() => ({
        selected: window.webSelection.selected.length,
        text: window.webSelection.text().slice(0, 80),
      }));
      // Scroll so the paint runs under the site's header. The wheel goes to what is under the
      // pointer, so keep the pointer over the article, not over a side bar that scrolls.
      await page.mouse.move(start.x + 200, start.y + 60);
      await page.mouse.wheel(0, start.y + 40);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(out, `${name}-under-header.png`) });
    }
    const bars = await page.evaluate(() => {
      const el = document.querySelector("web-selection-brush").shadowRoot.querySelector(".paint");
      return el.style.clipPath ? (el.style.clipPath.match(/M/g) ?? []).length - 1 : 0;
    });
    console.log(JSON.stringify({ name, enableMs, result, moved: typeof moved === "number" ? moved : null, bars, errors: errors.slice(0, 3) }));
  } catch (err) {
    console.log(JSON.stringify({ name, failed: String(err.message ?? err).slice(0, 200), errors }));
  }
  await context.close();
}
await browser.close();

// Visual check: loads the built content script into a test page, paints with the brush, and
// saves screenshots. Build first (npm run build) and serve the pages (npm run fixtures).
// Usage: node scripts/shoot.mjs [outDir] [--scheme dark] [--width 1280] [--browser chrome|msedge]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const out = args[0] && !args[0].startsWith("--") ? args[0] : "shots";
const scheme = flag("--scheme", "light");
const width = +flag("--width", "1280");
const channel = flag("--browser", "chrome");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/tests/fixtures/article.html", { waitUntil: "networkidle" });
await page.addScriptTag({ path: "extension/content.js" });
await page.evaluate(() => window.webSelection.enable());

const shot = async (name) => {
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("shot", name, JSON.stringify(await page.evaluate(() => window.webSelection.selected.map((e) => e.localName))));
};
const box = async (sel, nth = 0) => {
  const loc = page.locator(sel).nth(nth);
  return loc.boundingBox();
};
const drag = async (points, opts = {}) => {
  await page.mouse.move(points[0][0], points[0][1]);
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.down({ button: opts.button ?? "left" });
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 10 });
  if (opts.hold) return;
  await page.mouse.up({ button: opts.button ?? "left" });
  if (opts.alt) await page.keyboard.up("Alt");
};

await shot("01-start");

// Hover: the brush over a paragraph.
const p1 = await box("#why + p");
await page.mouse.move(p1.x + 200, p1.y + 20);
await shot("02-hover");

// A stroke down through the three paragraphs, held, so the paint shows mid-stroke.
await drag([[p1.x + 120, p1.y + 14], [p1.x + 200, p1.y + 120], [p1.x + 160, p1.y + 210]], { hold: true });
await shot("03-painting");
await page.mouse.up();
await page.mouse.move(p1.x + 900, p1.y + 300);
await shot("04-painted");

// Paint across the table and the chart.
await page.mouse.wheel(0, 380);
await page.waitForTimeout(200);
const t = await box("article table");
await drag([[t.x + 40, t.y + 70], [t.x + 360, t.y + 150], [t.x + 500, t.y + 330]]);
await page.mouse.move(t.x + 900, t.y + 100);
await shot("05-table-chart");

// Erase part of the table stroke with Alt.
await drag([[t.x + 20, t.y + 60], [t.x + 380, t.y + 160]], { alt: true });
await page.mouse.move(t.x + 900, t.y + 100);
await shot("06-erased");

// Bigger brush, paint the cards.
for (let i = 0; i < 8; i++) await page.keyboard.press("]");
await page.locator(".cards").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const c = await box(".cards");
await page.mouse.move(c.x + 60, c.y + 80);
await shot("07-big-hover");
await drag([[c.x + 60, c.y + 80], [c.x + c.width - 60, c.y + 90]]);
await page.mouse.move(c.x + c.width / 2, c.y + c.height + 80);
await shot("08-cards");

await page.keyboard.press("Escape");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("09-done");
console.log(JSON.stringify(await page.evaluate(() => window.webSelection.text().slice(0, 300))));
await browser.close();

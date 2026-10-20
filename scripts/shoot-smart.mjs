// Visual check for smart select on the playground: hover previews, parts and the grow steps.
// Usage: node scripts/shoot-smart.mjs [outDir] [--scheme dark]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith("--") ? args[0] : "shots";
const scheme = args.includes("--scheme") ? args[args.indexOf("--scheme") + 1] : "light";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
await page.goto("http://localhost:5199/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.ws?.enabled);
const shot = async (name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, `smart-${name}.png`) });
  console.log("shot", name);
};
const point = async (sel, nth = 0, dx = 60) => {
  const loc = page.locator(sel).nth(nth);
  await loc.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(100);
  const b = await loc.boundingBox();
  return [b.x + Math.min(dx, b.width / 2), b.y + Math.min(10, b.height / 2)];
};

let [x, y] = await point("article ol li", 2);
await page.mouse.move(x, y);
await shot("01-hover-list");
await page.mouse.click(x, y);
await page.mouse.move(1240, 300);
await shot("02-list");

[x, y] = await point("svg.chart", 0, 300);
await page.mouse.move(x, y + 60);
await shot("03-hover-figure");

[x, y] = await point(".note p", 1);
await page.mouse.click(x, y);
await page.mouse.move(1240, 300);
await shot("04-note");

const p = await point("#where ~ p", 2);
await page.mouse.click(...p);
await page.mouse.move(1240, 300);
await shot("05-paragraph");
await page.mouse.move(...p);
await shot("06-hover-grow");
await page.mouse.click(...p);
await page.mouse.move(1240, 300);
await shot("07-grown");
await page.mouse.click(...p);
await page.mouse.move(1240, 300);
await shot("08-grown-section");

[x, y] = await point(".card-text", 1);
await page.mouse.move(x, y);
await shot("09-hover-card");
await browser.close();

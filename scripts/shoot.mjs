// Visual check: drives the playground in a real browser and saves screenshots of each tool.
// Usage: node scripts/shoot.mjs [outDir] [--scheme dark] [--width 1280] [--browser chrome|msedge]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const out = args[0] && !args[0].startsWith("--") ? args[0] : "shots";
const scheme = flag("--scheme", "light");
const width = +flag("--width", "1280");
const channel = flag("--browser", "chrome");
const base = flag("--url", "http://localhost:5199/");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[page]", m.type(), m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
const shot = async (name) => {
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("shot", name);
};
const center = async (sel, nth = 0) => {
  const box = await page.locator(sel).nth(nth).boundingBox();
  return [box.x + box.width / 2, box.y + Math.min(box.height / 2, 12)];
};
const sel = () => page.evaluate(() => {
  const s = window.ws.selection;
  return { stats: s.stats, text: s.text().slice(0, 400) };
});

await shot("01-start");

// Wand hover preview over the first body paragraph.
let [x, y] = await center("article h2#why + p");
await page.mouse.move(x, y);
await shot("02-wand-hover");
await page.mouse.click(x, y);
await page.mouse.move(x + 200, 40);
await shot("03-wand-click");
console.log("wand", JSON.stringify(await sel()));

// Shift-click a list item to add the list.
await page.locator("article ol li").nth(1).scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
[x, y] = await center("article ol li", 1);
await page.keyboard.down("Shift");
await page.mouse.move(x, y);
await shot("04-wand-add-hover");
await page.mouse.click(x, y);
await page.keyboard.up("Shift");
await page.mouse.move(1000, 400);
await shot("05-wand-added");
console.log("added", JSON.stringify(await sel()));

// Mask view.
await page.keyboard.press("q");
await shot("06-mask");
await page.keyboard.press("q");

// Marquee over part of two paragraphs.
await page.keyboard.press("Control+d");
await page.keyboard.press("m");
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const p1 = await page.locator("article h2#why + p").boundingBox();
await page.mouse.move(p1.x + 120, p1.y + 8);
await page.mouse.down();
await page.mouse.move(p1.x + 300, p1.y + 60, { steps: 6 });
await page.mouse.move(p1.x + 420, p1.y + 120, { steps: 6 });
await shot("07-marquee-drag");
await page.mouse.up();
await page.mouse.move(1000, 300);
await shot("08-marquee-done");
console.log("marquee", JSON.stringify(await sel()));

// Lasso around a part of the table.
await page.keyboard.press("Control+d");
await page.keyboard.press("l");
const t = await page.locator("article table").boundingBox();
const pts = [[t.x - 10, t.y + 30], [t.x + 260, t.y + 20], [t.x + 300, t.y + 120], [t.x + 120, t.y + 170], [t.x - 10, t.y + 120]];
await page.mouse.move(...pts[0]);
await page.mouse.down();
for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 8 });
await shot("09-lasso-drag");
await page.mouse.up();
await shot("10-lasso-done");
console.log("lasso", JSON.stringify(await sel()));

// Brush across the cards.
await page.keyboard.press("Control+d");
await page.keyboard.press("b");
await page.locator(".cards").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const c = await page.locator(".cards").boundingBox();
await page.mouse.move(c.x + 20, c.y + 40);
await page.mouse.down();
await page.mouse.move(c.x + c.width * 0.6, c.y + 50, { steps: 12 });
await shot("11-brush-drag");
await page.mouse.up();
await shot("12-brush-done");
console.log("brush", JSON.stringify(await sel()));

// Text drag inside the Japanese paragraph.
await page.keyboard.press("Control+d");
await page.keyboard.press("t");
const jp = await page.locator("article h3 + p").nth(1).boundingBox();
await page.mouse.move(jp.x + 40, jp.y + 12);
await page.mouse.down();
await page.mouse.move(jp.x + 360, jp.y + 40, { steps: 8 });
await page.mouse.up();
await shot("13-text");
console.log("text", JSON.stringify(await sel()));

// Main text and invert.
await page.keyboard.press("w");
await page.evaluate(() => window.ws.run("mainText"));
await page.mouse.wheel(0, -3000);
await shot("14-main-text");
console.log("main", JSON.stringify((await sel()).stats));

await browser.close();

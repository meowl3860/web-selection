import { expect, test, type Locator, type Page } from "@playwright/test";

type Shot = { blocks: string[]; text: string; stats: { blocks: number; words: number; pictures: number }; whole: boolean[] };

declare global {
  interface Window {
    ws: import("../../src/index.js").WebSelection;
  }
}

async function open(page: Page, path = "/") {
  await page.goto(path);
  await page.waitForFunction(() => window.ws?.enabled);
}

function state(page: Page): Promise<Shot> {
  return page.evaluate(() => {
    const s = window.ws.selection;
    return {
      blocks: s.blocks.map((b) => (b.textContent ?? "").trim().slice(0, 40)),
      text: s.text(),
      stats: s.stats,
      whole: s.parts.map((p) => p.whole),
    };
  });
}

async function centerOf(loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  return { x: b.x + Math.min(b.width / 2, 200), y: b.y + Math.min(b.height / 2, 10) };
}

function overlayPath(page: Page, cls: string) {
  return page.evaluate((c) => document.querySelector("web-selection-overlay")!.shadowRoot!.querySelector(`.${c}`)!.getAttribute("d"), cls);
}

/** The ants outline's box in viewport coordinates. */
function antsBox(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector("web-selection-overlay")!;
    const path = host.shadowRoot!.querySelector(".ants-a") as SVGPathElement;
    if (!path.getAttribute("d")) return null;
    const b = path.getBBox();
    const o = host.getBoundingClientRect();
    return { x0: b.x + o.left, y0: b.y + o.top, x1: b.x + b.width + o.left, y1: b.y + b.height + o.top };
  });
}

test.describe("magic wand", () => {
  test("hover shows what a click takes, and a click takes the section's paragraphs", async ({ page }) => {
    await open(page);
    const c = await centerOf(page.locator("#why + p"));
    await page.mouse.move(c.x, c.y);
    await expect.poll(() => overlayPath(page, "preview-line")).toBeTruthy();
    await page.mouse.click(c.x, c.y);
    const s = await state(page);
    expect(s.stats.blocks).toBe(3);
    expect(s.text.startsWith("Frame rate is the number of frames")).toBe(true);
    expect(s.text.endsWith("how the game feels.")).toBe(true);
    expect(s.whole).toEqual([true, true, true]);
  });

  test("with Contiguous off it takes every alike paragraph on the page", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.ws.set({ contiguous: false }));
    const c = await centerOf(page.locator("#why + p"));
    await page.mouse.click(c.x, c.y);
    const expected = await page.locator("article > p:not(.kicker):not(.lede)").count();
    expect((await state(page)).stats.blocks).toBe(expected);
  });

  test("Shift adds, Alt subtracts, Shift+Alt intersects", async ({ page }) => {
    await open(page);
    const p = await centerOf(page.locator("#why + p"));
    await page.mouse.click(p.x, p.y);
    const li = await centerOf(page.locator("article ol li").nth(2));
    await page.keyboard.down("Shift");
    await page.mouse.click(li.x, li.y);
    await page.keyboard.up("Shift");
    expect((await state(page)).stats.blocks).toBe(3 + 6);

    const p2 = await centerOf(page.locator("#why + p"));
    await page.keyboard.down("Alt");
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.up("Alt");
    const left = await state(page);
    expect(left.stats.blocks).toBe(6);
    expect(left.text.startsWith("1. The depth prepass")).toBe(true);

    await page.keyboard.press("Control+a");
    const li2 = await centerOf(page.locator("article ol li").nth(0));
    await page.keyboard.down("Shift");
    await page.keyboard.down("Alt");
    await page.mouse.click(li2.x, li2.y);
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
    expect((await state(page)).stats.blocks).toBe(6);
  });

  test("a picture is a block of its own", async ({ page }) => {
    await open(page);
    const c = await centerOf(page.locator("svg.chart"));
    await page.mouse.click(c.x, c.y + 60);
    const s = await state(page);
    expect(s.stats.pictures).toBe(1);
    expect(s.text).toContain("[picture: Frame time falls fast");
  });
});

test.describe("shape tools", () => {
  test("the marquee takes the exact characters inside the box", async ({ page }) => {
    await open(page);
    await page.keyboard.press("m");
    const p = page.locator("#why + p");
    await p.scrollIntoViewIfNeeded();
    const b = (await p.boundingBox())!;
    await page.mouse.move(b.x + 100, b.y + 4);
    await page.mouse.down();
    await page.mouse.move(b.x + 400, b.y + 16, { steps: 5 });
    await page.mouse.up();
    const s = await state(page);
    const full = (await p.textContent())!.replace(/\s+/g, " ");
    expect(s.stats.blocks).toBe(1);
    expect(s.whole).toEqual([false]);
    expect(s.text.length).toBeGreaterThan(20);
    expect(full).toContain(s.text);
  });

  test("Whole blocks makes the marquee take each block it touches", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.ws.set({ tool: "marquee", wholeBlocks: true }));
    const p = page.locator("#why + p");
    await p.scrollIntoViewIfNeeded();
    const b = (await p.boundingBox())!;
    await page.mouse.move(b.x + 100, b.y + 4);
    await page.mouse.down();
    await page.mouse.move(b.x + 200, b.y + 16, { steps: 4 });
    await page.mouse.up();
    const s = await state(page);
    expect(s.whole).toEqual([true]);
    expect(s.text.endsWith("together they take 5 ms.")).toBe(true);
  });

  test("the lasso takes what it goes around", async ({ page }) => {
    await open(page);
    await page.keyboard.press("l");
    const t = page.locator("article table");
    await t.scrollIntoViewIfNeeded();
    const b = (await t.boundingBox())!;
    const pts = [[b.x - 8, b.y + 20], [b.x + 250, b.y + 20], [b.x + 250, b.y + 110], [b.x - 8, b.y + 110]];
    await page.mouse.move(pts[0]![0]!, pts[0]![1]!);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(x!, y!, { steps: 6 });
    await page.mouse.up();
    const s = await state(page);
    expect(s.text).toContain("Target");
    expect(s.text).toContain("Console, cinematic");
    expect(s.text).not.toContain("30 fps");
  });

  test("the brush takes whole blocks, and later strokes add", async ({ page }) => {
    await open(page);
    await page.keyboard.press("b");
    const cards = page.locator(".cards");
    await cards.scrollIntoViewIfNeeded();
    const b = (await cards.boundingBox())!;
    await page.mouse.move(b.x + 30, b.y + 56);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + 56, { steps: 4 });
    await page.mouse.up();
    const first = await state(page);
    expect(first.stats.blocks).toBeGreaterThanOrEqual(1);
    expect(first.whole.every(Boolean)).toBe(true);
    await page.mouse.move(b.x + b.width - 60, b.y + 56);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 40, b.y + 60, { steps: 2 });
    await page.mouse.up();
    const second = await state(page);
    expect(second.stats.blocks).toBeGreaterThan(first.stats.blocks);
    expect(second.text).toContain(first.text.split("\n")[0]!);
  });
});

test("with Whole blocks off, the brush paints only the characters under it", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.ws.set({ tool: "brush", brushBlocks: false, brushSize: 8 }));
  const p = page.locator("#why + p");
  await p.scrollIntoViewIfNeeded();
  const b = (await p.boundingBox())!;
  await page.mouse.move(b.x + 120, b.y + 12);
  await page.mouse.down();
  await page.mouse.move(b.x + 260, b.y + 12, { steps: 6 });
  await page.mouse.up();
  const s = await state(page);
  const full = (await p.textContent())!.replace(/\s+/g, " ");
  expect(s.whole).toEqual([false]);
  expect(s.text.length).toBeGreaterThan(10);
  expect(full).toContain(s.text);
});

test.describe("text tool", () => {
  test("drag selects text in reading order, also in Japanese", async ({ page }) => {
    await open(page);
    await page.keyboard.press("t");
    const jp = page.locator("article h3 + p").nth(1);
    await jp.scrollIntoViewIfNeeded();
    const b = (await jp.boundingBox())!;
    await page.mouse.move(b.x + 2, b.y + 12);
    await page.mouse.down();
    await page.mouse.move(b.x + 300, b.y + 12, { steps: 6 });
    await page.mouse.up();
    const s = await state(page);
    expect(s.text.startsWith("フレームレート")).toBe(true);
    expect(s.stats.blocks).toBe(1);
  });

  test("double-click takes one word", async ({ page }) => {
    await open(page);
    await page.keyboard.press("t");
    const p = page.locator("#budget + p");
    await p.scrollIntoViewIfNeeded();
    const b = (await p.boundingBox())!;
    await page.mouse.dblclick(b.x + 30, b.y + 12);
    const s = await state(page);
    expect(s.text).toMatch(/^\w+$/);
  });
});

test.describe("keys and commands", () => {
  test("tool keys, view key and tolerance keys", async ({ page }) => {
    await open(page);
    for (const [key, tool] of [["m", "marquee"], ["l", "lasso"], ["b", "brush"], ["t", "text"], ["w", "wand"]] as const) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => window.ws.settings.tool)).toBe(tool);
    }
    await page.keyboard.press("q");
    expect(await page.evaluate(() => window.ws.settings.view)).toBe("mask");
    const before = await page.evaluate(() => window.ws.settings.tolerance);
    await page.keyboard.press("]");
    expect(await page.evaluate(() => window.ws.settings.tolerance)).toBe(before + 5);
  });

  test("select all, deselect, reselect, invert, undo and redo", async ({ page }) => {
    await open(page);
    const c = await centerOf(page.locator("#why + p"));
    await page.mouse.click(c.x, c.y);
    const one = await state(page);
    await page.keyboard.press("Control+d");
    expect((await state(page)).stats.blocks).toBe(0);
    await page.keyboard.press("Control+Shift+d");
    expect((await state(page)).text).toBe(one.text);
    await page.keyboard.press("Control+i");
    const inv = await state(page);
    expect(inv.text).not.toContain("Frame rate is the number of frames");
    expect(inv.text).toContain("Frame time, not frame rate");
    await page.keyboard.press("Control+z");
    expect((await state(page)).text).toBe(one.text);
    await page.keyboard.press("Control+y");
    expect((await state(page)).text).toBe(inv.text);
    await page.keyboard.press("Control+a");
    expect((await state(page)).stats.blocks).toBeGreaterThan(60);
  });

  test("Main text takes the article and leaves the menus out", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.ws.run("mainText"));
    const s = await state(page);
    expect(s.text.startsWith("Profiling · 8 min read")).toBe(true);
    expect(s.text).not.toContain("On this page");
    expect(s.text).not.toContain("Render Notes");
  });

  test("Escape puts the tools away and keeps the selection", async ({ page }) => {
    await open(page);
    const c = await centerOf(page.locator("#why + p"));
    await page.mouse.click(c.x, c.y);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.ws.enabled)).toBe(false);
    expect((await state(page)).stats.blocks).toBe(3);
    expect(await overlayPath(page, "ants-a")).toBeTruthy();
  });

  test("Ctrl+C copies the selected text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const c = await centerOf(page.locator("#why + p"));
    await page.mouse.click(c.x, c.y);
    await page.keyboard.press("Control+c");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe((await state(page)).text);
  });
});

test.describe("page safety", () => {
  test("links do not open while the tools are on, and work again after", async ({ page }) => {
    await open(page);
    const link = page.locator(".toc a").first();
    const c = await centerOf(link);
    await page.mouse.click(c.x, c.y);
    expect(await page.evaluate(() => location.hash)).toBe("");
    await page.keyboard.press("Escape");
    await page.mouse.click(c.x, c.y);
    expect(await page.evaluate(() => location.hash)).toBe("#why");
  });

  test("the outline sits on the selected blocks, 3 px outside them", async ({ page }) => {
    await open(page);
    const p = page.locator("#why + p");
    const c = await centerOf(p);
    await page.mouse.click(c.x, c.y);
    await page.mouse.move(5, 300);
    await expect.poll(() => antsBox(page)).not.toBeNull();
    const box = (await antsBox(page))!;
    const first = (await p.boundingBox())!;
    const last = (await page.locator("#why ~ p").nth(2).boundingBox())!;
    expect(Math.abs(box.x0 - (first.x - 3))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y0 - (first.y - 3))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x1 - (first.x + first.width + 3))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y1 - (last.y + last.height + 3))).toBeLessThanOrEqual(1);
  });

  test("the selection follows the page when the page changes", async ({ page }) => {
    await open(page);
    const p = page.locator("#why + p");
    const c = await centerOf(p);
    await page.mouse.click(c.x, c.y);
    const before = await state(page);
    await page.evaluate(() => {
      const extra = document.createElement("p");
      extra.textContent = "A new paragraph that the page added after the selection was made.";
      document.querySelector("article h1")!.after(extra);
    });
    await page.waitForTimeout(500);
    expect((await state(page)).text).toBe(before.text);
    await page.mouse.move(5, 300);
    const box = (await antsBox(page))!;
    const first = (await p.boundingBox())!;
    expect(Math.abs(box.y0 - (first.y - 3))).toBeLessThanOrEqual(1);
  });

  test("a selection in a scroll box stays on its text and inside the box", async ({ page }) => {
    await open(page, "/cards.html");
    const target = page.locator(".scroller p").nth(1);
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((el) => window.ws.select(el));
    await page.evaluate(() => (document.querySelector(".scroller")!.scrollTop = 60));
    await page.waitForTimeout(150);
    const box = (await antsBox(page))!;
    const t = (await target.boundingBox())!;
    const s = (await page.locator(".scroller").boundingBox())!;
    expect(box.y0).toBeGreaterThanOrEqual(s.y);
    expect(Math.abs(box.y1 - (t.y + t.height + 3))).toBeLessThanOrEqual(1);
  });

  test("destroy leaves no trace in the page", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.ws.destroy());
    expect(await page.locator("web-selection-overlay").count()).toBe(0);
  });
});

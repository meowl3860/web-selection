import { expect, test, type Locator, type Page } from "@playwright/test";

declare global {
  interface Window {
    ws: import("../../src/index.js").WebSelection;
  }
}

async function open(page: Page, path = "/") {
  await page.goto(path);
  await page.waitForFunction(() => window.ws?.enabled);
}

async function clickOn(page: Page, loc: Locator, dx = 40) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  await page.mouse.click(b.x + Math.min(dx, b.width / 2), b.y + Math.min(10, b.height / 2));
}

function picked(page: Page) {
  return page.evaluate(() => {
    const s = window.ws.selection;
    return { text: s.text(), blocks: s.stats.blocks, kinds: s.parts.map((p) => p.kind), context: s.context() };
  });
}

test.describe("smart select", () => {
  test("is the tool the bar starts with", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => window.ws.settings.tool)).toBe("smart");
  });

  test("a paragraph is taken alone", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("#budget + p"));
    const s = await picked(page);
    expect(s.blocks).toBe(1);
    expect(s.text.startsWith("At 60 frames per second")).toBe(true);
  });

  test("a list comes with the sentence that leads into it", async ({ page }) => {
    await open(page);
    const li = page.locator("article ol li").nth(3);
    await li.scrollIntoViewIfNeeded();
    const b = (await li.boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 8);
    await expect.poll(() => page.evaluate(() => !!document.querySelector("web-selection-overlay")!.shadowRoot!.querySelector(".preview-line")!.getAttribute("d"))).toBe(true);
    await page.mouse.click(b.x + 40, b.y + 8);
    const s = await picked(page);
    expect(s.blocks).toBe(7);
    expect(s.text.startsWith("A deferred renderer such as Unreal's")).toBe(true);
    expect(s.text.endsWith("tone mapping and upscaling.")).toBe(true);
  });

  test("a nested list is taken from its outermost list", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("article ul ul li").first());
    const s = await picked(page);
    expect(s.text.startsWith("Two kinds of cost show up again and again:")).toBe(true);
    expect(s.text).toContain("Shader cost");
  });

  test("a picture comes with its caption", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("svg.chart"), 200);
    const s = await picked(page);
    expect(s.kinds).toEqual(["media", "caption"]);
    expect(s.text).toContain("Each extra frame per second buys less time");
  });

  test("a table is taken whole, with its caption", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("article td").nth(4));
    const s = await picked(page);
    expect(s.text.startsWith("Common frame rates and the time each frame gets")).toBe(true);
    expect(s.text).toContain("Esports monitor");
    expect(s.text).not.toContain("how the game feels");
  });

  test("a code block comes with the sentence that leads into it", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("article pre").first());
    const s = await picked(page);
    expect(s.kinds).toEqual(["paragraph", "code"]);
    expect(s.text).toContain("profilegpu");
  });

  test("a note box and a card are taken whole", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator(".note p").nth(1));
    expect((await picked(page)).text).toBe(
      'Note\n\nA game that is "GPU bound" gets no faster when you make the CPU work cheaper. First find out which side is slow, then work on that side.',
    );
    await clickOn(page, page.locator(".card-text").nth(1));
    expect((await picked(page)).text).toBe("Effects\n\nCheap smoke that still looks thick\n\nFewer sprites, soft edges and depth fade.");
  });

  test("a definition comes with its term", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("article dd").nth(2));
    expect((await picked(page)).text).toBe("Overdraw\nDrawing the same pixel more than once in one frame.");
  });

  test("a heading takes its section", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("#budget"));
    const s = await picked(page);
    expect(s.text.startsWith("The frame budget")).toBe(true);
    expect(s.text).toContain("Note");
    expect(s.text.endsWith("when an explosion fills the screen.")).toBe(true);
    expect(s.text).not.toContain("Where the time goes");
  });

  test("clicking inside the selection grows it to the section, then the page's section", async ({ page }) => {
    await open(page);
    const p = page.locator("#where ~ p").nth(2);
    await clickOn(page, p);
    expect((await picked(page)).text.startsWith("A fire with 40 large smoke sprites")).toBe(true);
    await clickOn(page, p);
    const h3 = await picked(page);
    expect(h3.text.startsWith("A smoke example")).toBe(true);
    await clickOn(page, p);
    const h2 = await picked(page);
    expect(h2.text.startsWith("Where the time goes")).toBe(true);
    expect(h2.text).not.toContain("How to measure");
    await clickOn(page, p);
    expect((await picked(page)).text.startsWith("Frame time, not frame rate")).toBe(true);
  });

  test("Section reach takes the section under the title at once", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.ws.set({ reach: "section" }));
    await clickOn(page, page.locator("#measure ~ p").nth(1));
    const s = await picked(page);
    expect(s.text.startsWith("How to measure")).toBe(true);
    expect(s.text).toContain("Measure first.");
  });

  test("the context gives the titles and the text around the selection", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("#budget ~ p").nth(1));
    const { context } = await picked(page);
    expect(context.titles).toEqual(["Frame time, not frame rate", "The frame budget"]);
    expect(context.before.startsWith("At 60 frames per second")).toBe(true);
    expect(context.after).toBe('A game that is "GPU bound" gets no faster when you make the CPU work cheaper. First find out which side is slow, then work on that side.');
  });

  test("Shift adds a second part and Alt takes one away", async ({ page }) => {
    await open(page);
    await clickOn(page, page.locator("#budget + p"));
    await page.keyboard.down("Shift");
    await clickOn(page, page.locator(".note p").nth(1));
    await page.keyboard.up("Shift");
    expect((await picked(page)).blocks).toBe(3);
    await page.keyboard.down("Alt");
    await clickOn(page, page.locator(".note p").nth(1));
    await page.keyboard.up("Alt");
    expect((await picked(page)).blocks).toBe(1);
  });

  test("the cards page: a tile is one part", async ({ page }) => {
    await open(page, "/cards.html");
    await clickOn(page, page.locator(".tile p").nth(2));
    const s = await picked(page);
    expect(s.text.startsWith("Flow map water")).toBe(true);
    expect(s.text).toContain("Medium");
  });
});

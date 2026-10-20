import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    ws: import("../../src/index.js").WebSelection;
  }
}

async function open(page: Page) {
  await page.goto("/cards.html");
  await page.waitForFunction(() => window.ws?.enabled);
}

/** A point inside an element in the card's shadow root. */
async function shadowPoint(page: Page, cls: string) {
  return page.evaluate((c) => {
    const el = document.querySelector("note-card")!.shadowRoot!.querySelector(`.${c}`)!;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  }, cls);
}

test.describe("web components and display: contents", () => {
  test("the wand reaches text inside a shadow root and the text in its slot", async ({ page }) => {
    await open(page);
    const p = await shadowPoint(page, "s1");
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    const text = await page.evaluate(() => window.ws.selection.text());
    expect(text).toContain("Shadow text one sits inside the shadow root.");
    expect(text).toContain("Shadow text two sits inside it as well.");
    expect(text).not.toContain("Shadow heading");
  });

  test("the outline lands on the shadow paragraph", async ({ page }) => {
    await open(page);
    const p = await shadowPoint(page, "s1");
    await page.evaluate(() => window.ws.set({ contiguous: true, tolerance: 0 }));
    await page.mouse.click(p.x, p.y);
    await page.mouse.move(5, 5);
    const ok = await page.evaluate(() => {
      const host = document.querySelector("web-selection-overlay")!;
      const path = host.shadowRoot!.querySelector(".ants-a") as SVGPathElement;
      const b = path.getBBox();
      const o = host.getBoundingClientRect();
      const t = document.querySelector("note-card")!.shadowRoot!.querySelector(".s1")!.getBoundingClientRect();
      return Math.abs(b.y + o.top - (t.top - 3)) <= 1 && Math.abs(b.x + o.left - (t.left - 3)) <= 1;
    });
    expect(ok).toBe(true);
  });

  test("the text tool places its caret inside a shadow root", async ({ page }) => {
    await open(page);
    await page.keyboard.press("t");
    const p = await shadowPoint(page, "s2");
    await page.mouse.move(p.x - 18, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 120, p.y, { steps: 5 });
    await page.mouse.up();
    const text = await page.evaluate(() => window.ws.selection.text());
    expect(text.length).toBeGreaterThan(5);
    expect("Shadow text two sits inside it as well.").toContain(text);
  });

  test("select() takes everything inside a component", async ({ page }) => {
    await open(page);
    const text = await page.evaluate(() => {
      window.ws.select(document.querySelector("note-card")!);
      return window.ws.selection.text();
    });
    expect(text).toBe(
      "Shadow heading\n\nShadow text one sits inside the shadow root.\n\nShadow text two sits inside it as well.\n\nLight text that the component shows through its slot.",
    );
  });

  test("a paragraph inside a display: contents wrapper can be selected", async ({ page }) => {
    await open(page);
    const p = page.locator(".contents-p");
    await p.scrollIntoViewIfNeeded();
    const b = (await p.boundingBox())!;
    await page.mouse.click(b.x + 40, b.y + b.height / 2);
    expect(await page.evaluate(() => window.ws.selection.text())).toContain("display is contents");
  });
});

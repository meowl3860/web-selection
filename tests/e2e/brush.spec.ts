import { expect, test, type Locator, type Page } from "@playwright/test";

declare global {
  interface Window {
    webSelection?: import("../../src/brush.js").Brush;
  }
}

type P = [number, number];

/** Opens a test page and loads the extension's content script into it, as the extension does. */
async function open(page: Page, path = "article.html") {
  await page.goto(path);
  await page.addScriptTag({ path: "extension/content.js" });
  await page.evaluate(() => window.webSelection!.enable());
}

function selected(page: Page): Promise<string[]> {
  return page.evaluate(() => window.webSelection!.selected.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)));
}

async function boxOf(loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  return (await loc.boundingBox())!;
}

async function paint(page: Page, points: P[], opts: { alt?: boolean } = {}) {
  await page.mouse.move(points[0]![0], points[0]![1]);
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}

/** How many painted pixels the page layer holds. */
function paintedPixels(page: Page) {
  return page.evaluate(() => {
    let n = 0;
    for (const c of document.querySelector("web-selection-brush")!.shadowRoot!.querySelectorAll<HTMLCanvasElement>(".paint canvas")) {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 16) if (d[i]! > 0) n++;
    }
    return n;
  });
}

function lookOf(loc: Locator) {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { look: el.getAttribute("data-ws-look"), font: cs.fontFamily, fill: cs.webkitTextFillColor, color: cs.color, rotate: cs.rotate };
  });
}

const CLEAR = "rgba(0, 0, 0, 0)";

/** The jittering letters drawn over an element: how many pixels, and a sum that changes when they move. */
function letters(loc: Locator) {
  return loc.evaluate((el) => {
    const canvas = document.querySelector("web-selection-brush")!.shadowRoot!.querySelector<HTMLCanvasElement>("canvas.jitter")!;
    const r = el.getBoundingClientRect();
    const k = canvas.width / document.documentElement.clientWidth;
    const w = Math.round(r.width * k), h = Math.round(r.height * k);
    if (!w || !h) return { ink: 0, sum: 0 };
    const d = canvas.getContext("2d")!.getImageData(Math.round(r.left * k), Math.round(r.top * k), w, h).data;
    let ink = 0, sum = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (!d[i]) continue;
      ink++;
      sum = (sum + d[i]! * (i % 9973)) % 1000000007;
    }
    return { ink, sum };
  });
}

test.describe("painting", () => {
  test("the brush shows a status line and paints over the page", async ({ page }) => {
    await open(page);
    await expect(page.locator("web-selection-brush")).toHaveCount(1);
    const hud = await page.evaluate(() => document.querySelector("web-selection-brush")!.shadowRoot!.querySelector(".hud")!.textContent);
    expect(hud).toContain("Paint over the page to select");
    expect(hud).toContain("Right-click removes a stroke");
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 10], [p.x + 300, p.y + 14]]);
    expect(await paintedPixels(page)).toBeGreaterThan(100);
  });

  test("what the paint covers is selected, in reading order", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#why + p"));
    await paint(page, [[p.x + 100, p.y + 10], [p.x + 160, p.y + 120], [p.x + 120, p.y + 210]]);
    expect(await selected(page)).toEqual([
      "Frame rate is the number of frames the ga",
      "Frame rate does not add up like that. A d",
      "So when you compare two scenes, two setti",
    ].map((t) => t.slice(0, 40)));
    const text = await page.evaluate(() => window.webSelection!.text());
    expect(text.startsWith("Frame rate is the number of frames")).toBe(true);
    expect(text.endsWith("how the game feels.")).toBe(true);
  });

  test("hovering shows which elements the brush is over, without selecting them", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await page.mouse.move(p.x + 100, p.y + 10);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("web-selection-brush")!.shadowRoot!.querySelector(".marks .near")!.getAttribute("d")))
      .toBeTruthy();
    expect(await selected(page)).toEqual([]);
  });

  test("[ and ] change the brush size", async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => window.webSelection!.size);
    await page.keyboard.press("]");
    await page.keyboard.press("]");
    expect(await page.evaluate(() => window.webSelection!.size)).toBe(before + 4);
    await page.keyboard.press("[");
    expect(await page.evaluate(() => window.webSelection!.size)).toBe(before + 2);
  });
});

test.describe("erasing, cancelling and history", () => {
  test("Alt erases, and an element with no paint left is no longer selected", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 240, p.y + 12]]);
    expect(await selected(page)).toHaveLength(1);
    // Part of the paint gone: still selected.
    await paint(page, [[p.x + 30, p.y + 12], [p.x + 120, p.y + 12]], { alt: true });
    expect(await selected(page)).toHaveLength(1);
    // All of it gone: not selected.
    await page.evaluate(() => (window.webSelection!.size = 30));
    await paint(page, [[p.x + 20, p.y + 12], [p.x + 270, p.y + 12]], { alt: true });
    expect(await selected(page)).toEqual([]);
  });

  test("the right button during a stroke cancels the whole stroke", async ({ page }) => {
    await open(page);
    const a = await boxOf(page.locator("#budget + p"));
    await paint(page, [[a.x + 40, a.y + 12], [a.x + 100, a.y + 12]]);
    const before = await paintedPixels(page);
    const b = await boxOf(page.locator("#budget ~ p").nth(1));
    await page.mouse.move(b.x + 40, b.y + 12);
    await page.mouse.down();
    await page.mouse.move(b.x + 200, b.y + 12, { steps: 6 });
    expect(await selected(page)).toHaveLength(2);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.mouse.up();
    expect(await selected(page)).toHaveLength(1);
    expect(await paintedPixels(page)).toBe(before);
    // The first stroke is still the one undo takes back.
    await page.keyboard.press("Control+z");
    expect(await selected(page)).toEqual([]);
  });

  test("right-click on a stroke takes that whole stroke away, and undo brings it back", async ({ page }) => {
    await open(page);
    const a = await boxOf(page.locator("#budget + p"));
    await paint(page, [[a.x + 40, a.y + 12], [a.x + 300, a.y + 12]]);
    const one = await paintedPixels(page);
    const b = await boxOf(page.locator("#budget ~ p").nth(1));
    await paint(page, [[b.x + 40, b.y + 12], [b.x + 300, b.y + 12]]);
    expect(await selected(page)).toHaveLength(2);
    // Right-click on the first stroke, in the middle of it.
    await page.mouse.click(a.x + 170, a.y + 12, { button: "right" });
    expect(await selected(page)).toHaveLength(1);
    expect((await selected(page))[0]).toContain("The CPU and the GPU");
    expect(await paintedPixels(page)).toBeLessThan(one * 1.5);
    await page.keyboard.press("Control+z");
    expect(await selected(page)).toHaveLength(2);
  });

  test("right-click on bare page does nothing", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    const before = await paintedPixels(page);
    await page.mouse.click(p.x + 400, p.y + 60, { button: "right" });
    expect(await paintedPixels(page)).toBe(before);
    expect(await selected(page)).toHaveLength(1);
  });

  test("Escape during a stroke cancels it and keeps the brush on", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await page.mouse.move(p.x + 40, p.y + 12);
    await page.mouse.down();
    await page.mouse.move(p.x + 200, p.y + 12, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await selected(page)).toEqual([]);
    expect(await paintedPixels(page)).toBe(0);
    expect(await page.evaluate(() => window.webSelection!.enabled)).toBe(true);
  });

  test("undo, redo and clear", async ({ page }) => {
    await open(page);
    const a = await boxOf(page.locator("#budget + p"));
    await paint(page, [[a.x + 40, a.y + 12], [a.x + 100, a.y + 12]]);
    const b = await boxOf(page.locator("#budget ~ p").nth(1));
    await paint(page, [[b.x + 40, b.y + 12], [b.x + 100, b.y + 12]]);
    expect(await selected(page)).toHaveLength(2);
    await page.keyboard.press("Control+z");
    expect(await selected(page)).toHaveLength(1);
    await page.keyboard.press("Control+Shift+z");
    expect(await selected(page)).toHaveLength(2);
    await page.keyboard.press("Delete");
    expect(await selected(page)).toEqual([]);
  });
});

test.describe("the look", () => {
  test("the letters of selected text jitter where they are, and the page does not move", async ({ page }) => {
    await open(page);
    const loc = page.locator("#why + p");
    const p = await boxOf(loc);
    const below = page.locator("article table");
    const before = { box: (await loc.boundingBox())!, below: (await below.boundingBox())!.y, font: (await lookOf(loc)).font };
    await paint(page, [[p.x + 100, p.y + 10], [p.x + 160, p.y + 120], [p.x + 120, p.y + 210]]);
    const look = await lookOf(loc);
    expect(look.look).toBe("jitter");
    // The page's own letters only lose their fill: same font, same place.
    expect(look.fill).toBe(CLEAR);
    expect(look.font).toBe(before.font);
    const after = (await loc.boundingBox())!;
    expect(after.y).toBeCloseTo(before.box.y, 1);
    expect(after.height).toBeCloseTo(before.box.height, 1);
    expect((await below.boundingBox())!.y).toBeCloseTo(before.below, 1);
    // The brush draws them again, and they move.
    await expect.poll(async () => (await letters(loc)).ink).toBeGreaterThan(500);
    const first = (await letters(loc)).sum;
    await expect.poll(async () => (await letters(loc)).sum).not.toBe(first);
  });

  test("letters of a script that joins, such as Arabic, move a word at a time", async ({ page }) => {
    await open(page);
    const loc = page.locator("#arabic");
    const p = await boxOf(loc);
    await paint(page, [[p.x + p.width - 20, p.y + p.height / 2], [p.x + 40, p.y + p.height / 2]]);
    await expect.poll(async () => (await letters(loc)).ink).toBeGreaterThan(300);
    // Each unit drawn is a whole word, so its letters keep their joined shapes.
    const units = await page.evaluate(() => {
      const j = (window.webSelection as unknown as { jitter: { entries: Map<Element, { runs: { glyphs: { ch: string }[] }[] }> } }).jitter;
      const e = j.entries.get(document.querySelector("#arabic")!)!;
      return e.runs.flatMap((r) => r.glyphs.map((g) => g.ch));
    });
    expect(units).toContain("الإطار");
    expect(units.every((u) => u.length > 1 || /[\p{P}\p{N}]/u.test(u))).toBe(true);
  });

  test("with reduced motion the letters keep one pose", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const loc = page.locator("#budget + p");
    const p = await boxOf(loc);
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    await expect.poll(async () => (await letters(loc)).ink).toBeGreaterThan(500);
    const first = await letters(loc);
    await page.waitForTimeout(350);
    expect(await letters(loc)).toEqual(first);
  });

  test("taking the paint away puts the text back as it was", async ({ page }) => {
    await open(page);
    const loc = page.locator("#budget + p");
    const p = await boxOf(loc);
    const plain = await lookOf(loc);
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    expect((await lookOf(loc)).fill).toBe(CLEAR);
    await expect.poll(async () => (await letters(loc)).ink).toBeGreaterThan(500);
    await page.keyboard.press("Control+z");
    expect(await lookOf(loc)).toEqual(plain);
    await expect.poll(async () => (await letters(loc)).ink).toBe(0);
  });

  test("a picture is pinned like a photo", async ({ page }) => {
    await open(page);
    const chart = page.locator("svg.chart");
    const c = await boxOf(chart);
    await paint(page, [[c.x + 200, c.y + 100], [c.x + 260, c.y + 120]]);
    expect(await page.evaluate(() => window.webSelection!.text())).toContain("[picture: Frame time falls fast");
    const look = await lookOf(chart);
    expect(look.look).toBe("pinned");
    expect(parseFloat(look.rotate)).toBeLessThan(0);
  });

  test("a picture in a card that clips it is framed, not tilted, so nothing of it is cut off", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const card = document.createElement("div");
      card.style.cssText = "width: 400px; height: 225px; border-radius: 16px; overflow: hidden; margin: 24px 0";
      card.innerHTML = '<img id="clipped" src="pictures/people.jpg" style="display: block; width: 100%; height: 100%; object-fit: cover">';
      document.querySelector("#budget")!.before(card);
    });
    const img = page.locator("#clipped");
    await img.evaluate((el: HTMLImageElement) => el.decode());
    const b = await boxOf(img);
    await paint(page, [[b.x + 120, b.y + 80], [b.x + 220, b.y + 120]]);
    // The picture came after the brush: it joins once the page is walked again in idle time,
    // and the selection catches up from the paint.
    await expect.poll(async () => (await lookOf(img)).look).toBe("framed");
    expect((await lookOf(img)).rotate).toBe("none");
  });

  test("the letters of a code block jitter in place, in its own font, so its columns stay", async ({ page }) => {
    await open(page);
    const pre = page.locator("article pre").first();
    const plain = await lookOf(pre);
    const b = await boxOf(pre);
    await paint(page, [[b.x + 40, b.y + 20], [b.x + 120, b.y + 20]]);
    const look = await lookOf(pre);
    expect(look.look).toBe("jitter");
    expect(look.font).toBe(plain.font);
    expect(look.rotate).toBe("none");
    await expect.poll(async () => (await letters(pre)).ink).toBeGreaterThan(500);
  });

  test("the brush's own style sheet loading does not make it measure the page again", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    // Count each time the brush forgets where everything is.
    await page.evaluate(() => {
      const w = window as unknown as { __relayouts: number };
      const b = window.webSelection as unknown as { relayout(): void };
      const f = b.relayout;
      w.__relayouts = 0;
      b.relayout = function () {
        w.__relayouts++;
        return f.call(this);
      };
    });
    // A stroke over a picture changes the style sheet: the picture's tilt is a rule in it.
    const c = await boxOf(page.locator("svg.chart"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    await paint(page, [[c.x + 200, c.y + 100], [c.x + 260, c.y + 120]]);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { __relayouts: number }).__relayouts)).toBe(0);
  });

  test("a card's title and text both jitter", async ({ page }) => {
    await open(page);
    const card = page.locator(".card").nth(1);
    const c = await boxOf(card);
    await paint(page, [[c.x + 30, c.y + 60], [c.x + 30, c.y + c.height - 20]]);
    for (const part of [".card-title", ".card-text"]) {
      expect((await lookOf(card.locator(part))).look).toBe("jitter");
      await expect.poll(async () => (await letters(card.locator(part))).ink).toBeGreaterThan(200);
    }
  });

  test("clearing takes every look and style sheet off the page", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    expect(await page.locator("style[data-web-selection]").count()).toBe(1);
    await page.keyboard.press("Delete");
    expect(await page.locator("[data-ws-look], [data-ws-n]").count()).toBe(0);
    expect(await page.locator("style[data-web-selection]").count()).toBe(0);
  });
});

test.describe("the page", () => {
  test("paint at the very bottom never makes the page longer", async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await paint(page, [[600, 860], [700, 895]]);
    expect(await paintedPixels(page)).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(before);
  });

  test("paint stays on its place on the page when the page scrolls", async ({ page }) => {
    await open(page);
    const loc = page.locator("#budget + p");
    const p = await boxOf(loc);
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    const gap = () =>
      page.evaluate(() => {
        const tile = document.querySelector("web-selection-brush")!.shadowRoot!.querySelector(".paint canvas")!.getBoundingClientRect();
        return document.querySelector("#budget + p")!.getBoundingClientRect().top - tile.top;
      });
    const before = await gap();
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(250);
    expect(await gap()).toBe(before);
  });

  test("links do not open while the brush is on; Escape puts it away and keeps the selection", async ({ page }) => {
    await open(page);
    const link = await boxOf(page.locator(".toc a").first());
    // A click is a dab of paint: it selects the link instead of opening it.
    await page.mouse.click(link.x + 10, link.y + 6);
    expect(await page.evaluate(() => location.hash)).toBe("");
    expect(await selected(page)).toEqual(["Why milliseconds"]);
    await page.keyboard.press("Delete");
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.webSelection!.enabled)).toBe(false);
    expect(await selected(page)).toHaveLength(1);
    expect((await lookOf(page.locator("#budget + p"))).look).toBe("jitter");
    const l2 = await boxOf(page.locator(".toc a").first());
    await page.mouse.click(l2.x + 10, l2.y + 6);
    expect(await page.evaluate(() => location.hash)).toBe("#why");
  });

  test("the sticky header covers the page's paint", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    await page.mouse.move(5, 400);
    const clip = await page.evaluate(() => (document.querySelector("web-selection-brush")!.shadowRoot!.querySelector(".paint") as HTMLElement).style.clipPath);
    expect(clip).toContain("evenodd");
  });

  test("paint that starts on the sticky header stays with it and selects its links", async ({ page }) => {
    await open(page);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const nav = (await page.locator(".top-nav").boundingBox())!;
    await paint(page, [[nav.x + 4, nav.y + nav.height / 2], [nav.x + 120, nav.y + nav.height / 2]]);
    expect(await selected(page)).toEqual(["Basics", "Profiling"]);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    expect(await selected(page)).toEqual(["Basics", "Profiling"]);
    const screenTiles = await page.evaluate(() => document.querySelector("web-selection-brush")!.shadowRoot!.querySelectorAll(".screen-paint canvas").length);
    expect(screenTiles).toBeGreaterThan(0);
    expect((await lookOf(page.locator(".top-nav a").first())).look).toBe("jitter");
  });

  test("Ctrl+C copies the selected text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    await page.keyboard.press("Control+c");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.startsWith("At 60 frames per second")).toBe(true);
  });

  test("destroy leaves nothing in the page", async ({ page }) => {
    await open(page);
    const p = await boxOf(page.locator("#budget + p"));
    await paint(page, [[p.x + 40, p.y + 12], [p.x + 100, p.y + 12]]);
    await page.evaluate(() => window.webSelection!.destroy());
    await expect(page.locator("web-selection-brush")).toHaveCount(0);
    expect(await page.locator("[data-ws-look], style[data-web-selection]").count()).toBe(0);
  });
});

test.describe("web components", () => {
  test("text inside a shadow root can be painted and jitters there", async ({ page }) => {
    await open(page, "cards.html");
    const p = await page.evaluate(() => {
      const el = document.querySelector("note-card")!.shadowRoot!.querySelector(".s1")!;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2 };
    });
    await paint(page, [[p.x + 20, p.y], [p.x + 80, p.y]]);
    expect(await selected(page)).toEqual(["Shadow text one sits inside the shadow r"]);
    // The style sheet goes into the shadow root, so the letters there lose their fill too.
    const fill = await page.evaluate(() => getComputedStyle(document.querySelector("note-card")!.shadowRoot!.querySelector(".s1")!).webkitTextFillColor);
    expect(fill).toBe(CLEAR);
    const inner = page.locator("note-card .s1");
    await expect.poll(async () => (await letters(inner)).ink).toBeGreaterThan(200);
  });

  test("a paragraph inside a display: contents wrapper can be painted", async ({ page }) => {
    await open(page, "cards.html");
    const b = await boxOf(page.locator(".contents-p"));
    await paint(page, [[b.x + 20, b.y + b.height / 2], [b.x + 80, b.y + b.height / 2]]);
    expect(await page.evaluate(() => window.webSelection!.text())).toBe("A paragraph inside a wrapper whose display is contents.");
  });
});

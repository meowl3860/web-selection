import { expect, test, type Page } from "@playwright/test";
import type { Brush, BrushOptions } from "../../src/brush.js";
import type { AIContext, ContextOptions, toContext } from "../../src/context/index.js";

declare global {
  interface Window {
    brush: Brush;
    toContext: typeof toContext;
    events: string[];
    ready?: boolean;
  }
}

type P = [number, number];
type Box = { x: number; y: number; w: number; h: number };

/** Opens a test page with the library loaded from source, and a brush turned on. */
async function setup(page: Page, path: string, options: BrushOptions = {}, size = 8) {
  await page.goto(path);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createBrush } from "/src/index.ts";
      import { toContext } from "/src/context/index.ts";
      window.events = [];
      window.brush = createBrush(${JSON.stringify(options)});
      window.brush.on("start", (e) => window.events.push("start"));
      window.brush.on("end", (e) => window.events.push(e.cancelled ? "cancelled" : "end"));
      window.toContext = toContext;
      window.brush.size = ${size};
      window.brush.enable();
      window.ready = true;`,
  });
  await page.waitForFunction(() => window.ready === true);
}

async function drag(page: Page, points: P[]) {
  await page.mouse.move(points[0]![0], points[0]![1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

/** Where a phrase shows inside an element, scrolled into the middle of the screen. */
function phrase(page: Page, selector: string, text: string): Promise<Box> {
  return page.evaluate(
    ([selector, text]) => {
      const el = document.querySelector(selector)!;
      el.scrollIntoView({ block: "center" });
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const i = n.data.indexOf(text);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + text.length);
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      }
      throw new Error(`no "${text}" in ${selector}`);
    },
    [selector, text] as const,
  );
}

/** Paints along the middle of a phrase. */
async function paintPhrase(page: Page, selector: string, text: string) {
  const r = await phrase(page, selector, text);
  await drag(page, [[r.x + 2, r.y + r.h / 2], [r.x + r.w - 2, r.y + r.h / 2]]);
}

function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector)!;
    el.scrollIntoView({ block: "center" });
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, selector);
}

function context(page: Page, options: Omit<ContextOptions, "pixels" | "shadowRoot"> = {}): Promise<AIContext> {
  return page.evaluate((o) => window.toContext(window.brush.items(), o), options);
}

const images = (c: AIContext) => c.parts.filter((p) => p.type === "image");

test.describe("what the paint covers", () => {
  test("the painted words come back as ranges", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    const items = await page.evaluate(() => window.brush.items().map((i) => ({ tag: i.element.localName, words: i.ranges.map((r) => r.toString()) })));
    expect(items).toEqual([{ tag: "p", words: ["6.7 ms"] }]);
  });

  test("paint that only grazes a line paints no words", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    const r = await phrase(page, "#why + p + p", "6.7 ms");
    await page.evaluate(() => (window.brush.size = 4));
    await drag(page, [[r.x, r.y + r.h + 2.5], [r.x + r.w, r.y + r.h + 2.5]]);
    const items = await page.evaluate(() => window.brush.items().map((i) => i.ranges.length));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((n) => n === 0)).toBe(true);
  });

  test("the painted place on a picture, as a share of its size", async ({ page }) => {
    await setup(page, "pictures.html", { look: "none" }, 10);
    const b = await boxOf(page, "#people");
    await drag(page, [[b.x + b.w * 0.3, b.y + b.h * 0.6], [b.x + b.w * 0.3 + 1, b.y + b.h * 0.6]]);
    const area = await page.evaluate(() => window.brush.items()[0]!.area);
    expect(area.width).toBeCloseTo(b.w, 0);
    const cx = (area.box!.x0 + area.box!.x1) / 2, cy = (area.box!.y0 + area.box!.y1) / 2;
    expect(Math.abs(cx - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(cy - 0.6)).toBeLessThan(0.03);
    expect(area.coverage).toBeGreaterThan(0);
  });

  test("on a pinned picture, paint is measured on the picture without its tilt", async ({ page }) => {
    await setup(page, "pictures.html", {}, 6);
    const b = await boxOf(page, "#people");
    // The first dab pins the picture and tilts it.
    await drag(page, [[b.x + b.w * 0.5, b.y + b.h * 0.5], [b.x + b.w * 0.5 + 1, b.y + b.h * 0.5]]);
    await expect(page.locator("[data-ws-look=pinned]")).toHaveCount(1);
    // Where the point at 80% across and 30% down of the picture now shows on the screen.
    const at = await page.evaluate(() => {
      const pinned = document.querySelector("[data-ws-look=pinned]")!;
      const img = document.querySelector("#people")!;
      const deg = parseFloat(getComputedStyle(pinned).rotate) || 0;
      pinned.removeAttribute("data-ws-look");
      const p = pinned.getBoundingClientRect(), r = img.getBoundingClientRect();
      pinned.setAttribute("data-ws-look", "pinned");
      const cx = p.left + p.width / 2, cy = p.top + p.height / 2;
      const x = r.left + r.width * 0.8 - cx, y = r.top + r.height * 0.3 - cy;
      const a = (deg * Math.PI) / 180;
      return { deg, x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a), w: r.width, h: r.height };
    });
    expect(at.deg).not.toBe(0);
    await drag(page, [[at.x, at.y], [at.x + 0.5, at.y]]);
    const last = await page.evaluate(() => window.brush.items()[0]!.area.strokes.at(-1)!.points[0]!);
    expect(Math.abs(last[0] - at.w * 0.8)).toBeLessThan(1.5);
    expect(Math.abs(last[1] - at.h * 0.3)).toBeLessThan(1.5);
  });
});

test.describe("options and events", () => {
  test("a selector names the elements that count, each selected whole", async ({ page }) => {
    await setup(page, "article.html", { targets: ".card", look: "none" }, 6);
    await paintPhrase(page, "#budget + p", "16.7 ms");
    expect(await page.evaluate(() => window.brush.selected.length)).toBe(0);
    await paintPhrase(page, ".card:nth-child(2) .card-title", "Cheap smoke");
    const sel = await page.evaluate(() => window.brush.items().map((i) => ({ cls: i.element.className, text: i.textNodes.map((n) => n.data).join("|") })));
    expect(sel).toEqual([{ cls: "card", text: "Effects|Cheap smoke that still looks thick|Fewer sprites, soft edges and depth fade." }]);
  });

  test("look none leaves the page as it is; the paint takes the colour; the status line can stay hidden", async ({ page }) => {
    await setup(page, "article.html", { look: "none", color: "rgb(230, 20, 20)", hud: false });
    const r = await phrase(page, "#budget + p", "16.7 ms");
    await drag(page, [[r.x + 2, r.y + r.h / 2], [r.x + r.w - 2, r.y + r.h / 2]]);
    expect(await page.evaluate(() => window.brush.selected.length)).toBe(1);
    await expect(page.locator("[data-ws-look]")).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector("web-selection-brush")!.shadowRoot!.querySelector<HTMLElement>(".hud")!.hidden)).toBe(true);
    const rgb = await page.evaluate(([x, y]) => {
      const root = document.querySelector("web-selection-brush")!.shadowRoot!;
      for (const c of root.querySelectorAll<HTMLCanvasElement>(".paint canvas")) {
        const b = c.getBoundingClientRect();
        if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
        const k = c.width / b.width;
        const d = c.getContext("2d")!.getImageData(Math.round((x - b.left) * k), Math.round((y - b.top) * k), 1, 1).data;
        return [d[0], d[1], d[2]];
      }
      return null;
    }, [r.x + r.w / 2, r.y + r.h / 2] as const);
    expect(rgb).toEqual([230, 20, 20]);
  });

  test("start and end mark each stroke, and a cancelled one says so", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#budget + p", "16.7 ms");
    const r = await phrase(page, "#budget + p", "budget");
    await page.mouse.move(r.x, r.y + r.h / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w, r.y + r.h / 2, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await page.evaluate(() => window.events)).toEqual(["start", "end", "start", "cancelled"]);
  });
});

test.describe("context for a model", () => {
  test("marked text: the painted words between marks, where on the page, and the text around", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    const c = await context(page);
    expect(c.parts).toHaveLength(1);
    expect(c.text).toContain("The painted words are between <mark> and </mark>.");
    expect(c.text).toContain("Page: Frame time, not frame rate · Render Notes");
    expect(c.text).toContain("Section: Frame time, not frame rate > Why milliseconds");
    expect(c.text).toContain("is also five frames, but it costs <mark>6.7 ms</mark>. The same");
    expect(c.text).toMatch(/<before>\n[^]*only frame time adds up[^]*<\/before>/);
    expect(c.text).toMatch(/<after>\nSo when you compare two scenes/);
    expect(c.tokens).toBeGreaterThan(100);
  });

  test("a single touch points at the whole paragraph, not the word under the dab", async ({ page }) => {
    await setup(page, "article.html", { look: "none" }, 16);
    const r = await phrase(page, "#budget + p + p", "slowest");
    await drag(page, [[r.x + r.w / 2, r.y + r.h / 2], [r.x + r.w / 2 + 1, r.y + r.h / 2]]);
    const c = await context(page, { around: 0 });
    expect(c.text).toContain("So the frame takes as long as the slowest of them, not the sum.");
    expect(c.text).not.toContain("<mark>");
  });

  test("whole and painted modes", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    const whole = await context(page, { text: "whole", around: 0 });
    expect(whole.text).not.toContain("<mark>");
    expect(whole.text).toContain("<selection>\n\nFrame rate does not add up like that.");
    const painted = await context(page, { text: "painted", around: 0 });
    expect(painted.text).toContain("Only the painted words of the text are given.");
    expect(painted.text).toContain("<selection>\n\n6.7 ms\n\n</selection>");
  });

  test("a table cell comes with its header row", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "tbody tr:nth-child(2) td:nth-child(3)", "16.7 ms");
    const c = await context(page, { around: 0 });
    expect(c.text).toContain(
      ["Table: Common frame rates and the time each frame gets", "| Target | Frame rate | Frame time |", "| --- | --- | --- |", "| Console, performance | 60 fps | <mark>16.7 ms</mark> |"].join("\n"),
    );
  });

  test("code keeps its lines and its language", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "pre:has(.language-cpp)", "(FPlatformTime::Seconds() - Start)");
    const c = await context(page, { around: 0 });
    expect(c.text).toContain("```cpp\nconst double Start = FPlatformTime::Seconds();\nRunTheWork();\nconst double Ms = <mark>(FPlatformTime::Seconds() - Start)</mark> * 1000.0;");
  });

  test("plain elements, and the page's own text selection, work without the brush", async ({ page }) => {
    await setup(page, "article.html");
    const c = await page.evaluate(async () => {
      const p = document.querySelector("#budget + p")!;
      const el = await window.toContext([p], { around: 0 });
      const text = p.firstChild as Text;
      const r = document.createRange();
      r.setStart(text, text.data.indexOf("16.7 ms"));
      r.setEnd(text, text.data.indexOf("16.7 ms") + 7);
      const range = await window.toContext([r], { around: 0 });
      return { el: el.text, range: range.text };
    });
    expect(c.el).toContain("At 60 frames per second, every frame has 16.7 ms. That is the budget.");
    expect(c.el).not.toContain("<mark>");
    expect(c.range).toContain("At 60 frames per second, every frame has <mark>16.7 ms</mark>. That is the budget.");
  });

  test("JSON gives the same facts as data", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    const c = await context(page, { format: "json", around: 0 });
    const doc = JSON.parse(c.parts[0]!.type === "text" ? c.parts[0]!.text : "");
    expect(doc.section).toEqual(["Frame time, not frame rate", "Why milliseconds"]);
    expect(doc.selection[0].type).toBe("paragraph");
    expect(doc.selection[0].text).toContain("<mark>6.7 ms</mark>");
  });

  test("pictures in each mode", async ({ page }) => {
    await setup(page, "pictures.html", { look: "none" }, 12);
    const b = await boxOf(page, "#people");
    await drag(page, [[b.x + b.w * 0.49, b.y + b.h * 0.45], [b.x + b.w * 0.51, b.y + b.h * 0.6], [b.x + b.w * 0.49, b.y + b.h * 0.75]]);
    const full = await context(page, { images: "full" });
    expect(images(full).map((p) => p.label)).toEqual(["Picture 1:", "Picture 1 with the user's paint on it:"]);
    expect(images(full).map((p) => [p.width, p.height, p.mediaType])).toEqual([[800, 450, "image/jpeg"], [800, 450, "image/jpeg"]]);
    expect(full.text).toMatch(/\[Picture 1: "The team at the park"; caption "The team at the park, from left to right."; painted area x 4\d–5\d%, y \d\d–\d\d% \(from the top left\)\]/);
    const balanced = await context(page, { images: "balanced" });
    expect(images(balanced).map((p) => [p.label, p.width])).toEqual([["Picture 1 with the user's paint on it:", 768]]);
    const budget = await context(page, { images: "budget" });
    expect(images(budget).map((p) => p.label)).toEqual(["Picture 1, the painted part:"]);
    expect(images(budget)[0]!.width).toBeLessThan(200);
    const none = await context(page, { images: "none" });
    expect(images(none)).toHaveLength(0);
    expect(none.text).toContain("painted area x");
    const own = await context(page, { images: { original: true } });
    expect(images(own).map((p) => p.label)).toEqual(["Picture 1:"]);
    expect(own.text).not.toContain("painted area");
    expect(full.tokens).toBeGreaterThan(balanced.tokens);
    expect(balanced.tokens).toBeGreaterThan(budget.tokens);
    expect(budget.tokens).toBeGreaterThan(none.tokens);
  });

  test("the project's own pixels stand in for a picture the page cannot read", async ({ page }) => {
    await setup(page, "pictures.html", { look: "none" }, 12);
    // A frame's pixels are never the page's to read.
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "frame";
      frame.srcdoc = "<p style='font: 40px sans-serif'>Inside a frame</p>";
      frame.style.cssText = "display: block; width: 400px; height: 225px; border: 0";
      document.querySelector("#people")!.closest("figure")!.before(frame);
    });
    const b = await boxOf(page, "#frame");
    await drag(page, [[b.x + b.w * 0.5, b.y + b.h * 0.5], [b.x + b.w * 0.55, b.y + b.h * 0.55]]);
    const size = await page.evaluate(async () => {
      const shot = document.createElement("canvas");
      shot.width = 200;
      shot.height = 112;
      const c = await window.toContext(window.brush.items(), { images: { original: true }, pixels: () => shot });
      const img = c.parts.find((p) => p.type === "image");
      return img && img.type === "image" ? [img.width, img.height] : null;
    });
    expect(size).toEqual([200, 112]);
  });

  test("a picture from another site is read again with CORS", async ({ page }) => {
    await setup(page, "pictures.html", { look: "none" }, 12);
    // The same picture from another origin, the server's IPv6 address: the page may show it but
    // not read it.
    await page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>("#people")!;
      img.src = img.src.replace("localhost", "[::1]");
      await img.decode();
    });
    const b = await boxOf(page, "#people");
    await drag(page, [[b.x + b.w * 0.5, b.y + b.h * 0.5], [b.x + b.w * 0.55, b.y + b.h * 0.55]]);
    const c = await context(page, { images: { original: true } });
    expect(c.text).not.toContain("could not be read");
    expect(images(c).map((p) => [p.width, p.height])).toEqual([[800, 450]]);
  });

  test("unmarked hides the brush and the look while it runs, then puts them back", async ({ page }) => {
    await setup(page, "pictures.html", {}, 12);
    const b = await boxOf(page, "#people");
    await drag(page, [[b.x + b.w * 0.5, b.y + b.h * 0.5], [b.x + b.w * 0.55, b.y + b.h * 0.55]]);
    await expect(page.locator("[data-ws-look]")).toHaveCount(1);
    const during = await page.evaluate(() =>
      window.brush.unmarked(() => ({
        overlay: getComputedStyle(document.querySelector("web-selection-brush")!).visibility,
        looks: document.querySelectorAll("[data-ws-look]").length,
      })),
    );
    expect(during).toEqual({ overlay: "hidden", looks: 0 });
    await expect(page.locator("[data-ws-look]")).toHaveCount(1);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("web-selection-brush")!).visibility)).toBe("visible");
  });

  test("a token budget is kept, and the painted words stay", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    await paintPhrase(page, "#budget + p", "16.7 ms");
    const free = await context(page);
    const tight = await context(page, { budget: 120 });
    expect(free.tokens).toBeGreaterThan(200);
    expect(tight.tokens).toBeLessThanOrEqual(120);
    expect(tight.text).toContain("<mark>6.7 ms</mark>");
    expect(tight.text).toContain("<mark>16.7 ms</mark>");
  });
});

test.describe("marks and notes", () => {
  const badges = (page: Page) => page.evaluate(() => [...document.querySelector("web-selection-brush")!.shadowRoot!.querySelectorAll(".badge text")].map((t) => t.textContent));

  test("a note ends a mark, so the next stroke starts mark 2; both are numbered on the page", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    expect(await page.evaluate(() => window.brush.marks().map((m) => [m.n, m.note]))).toEqual([[1, ""]]);
    await expect.poll(() => badges(page)).toEqual([]);
    await page.evaluate(() => window.brush.note(window.brush.marks()[0]!.id, "Is this right?"));
    await expect.poll(() => badges(page)).toEqual(["1"]);
    await paintPhrase(page, "tbody tr:nth-child(3) td:nth-child(3)", "8.3 ms");
    expect(await page.evaluate(() => window.brush.marks().map((m) => [m.n, m.note]))).toEqual([[1, "Is this right?"], [2, ""]]);
    await expect.poll(() => badges(page)).toEqual(["1", "2"]);
    const items = await page.evaluate(() => window.brush.items().map((i) => i.marks.map((m) => [m.n, m.ranges.map((r) => r.toString())])));
    expect(items).toEqual([[[1, ["6.7 ms"]]], [[2, ["8.3 ms"]]]]);
  });

  test("the context numbers the marks in the text and lists the notes last", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    await page.evaluate(() => window.brush.note(window.brush.marks()[0]!.id, "Is this right?"));
    await paintPhrase(page, "tbody tr:nth-child(3) td:nth-child(3)", "8.3 ms");
    const c = await context(page, { around: 0 });
    expect(c.text).toContain("The user marked 2 places on a web page by painting over them, numbered from 1, and wrote notes, which come last.");
    expect(c.text).toContain('but it costs <mark id="1">6.7 ms</mark>.');
    expect(c.text).toContain('| High refresh monitor | 120 fps | <mark id="2">8.3 ms</mark> |');
    expect(c.text.endsWith("The user's notes, by mark:\n1. Is this right?\n2. (no note)")).toBe(true);
    const json = JSON.parse((await context(page, { around: 0, format: "json" })).text);
    expect(json.notes).toEqual([{ mark: 1, note: "Is this right?" }, { mark: 2, note: "" }]);
  });

  test("two marks on one picture: a box for each, a numbered copy, and a crop for each", async ({ page }) => {
    await setup(page, "pictures.html", { look: "none" }, 12);
    const b = await boxOf(page, "#people");
    await drag(page, [[b.x + b.w * 0.14, b.y + b.h * 0.5], [b.x + b.w * 0.14, b.y + b.h * 0.75]]);
    await page.evaluate(() => window.brush.note(window.brush.marks()[0]!.id, "Remove this person."));
    await drag(page, [[b.x + b.w * 0.84, b.y + b.h * 0.5], [b.x + b.w * 0.84, b.y + b.h * 0.75]]);
    await page.evaluate(() => window.brush.note(window.brush.marks()[1]!.id, "Make this one bigger."));
    const full = await context(page, { images: "full" });
    expect(full.text).toMatch(/\[Picture 1: "The team at the park" \[Marks 1, 2\]; caption "[^"]+"; painted area mark 1 x 1\d–1\d%, y \d\d–\d\d% \(from the top left\); mark 2 x 8\d–8\d%/);
    expect(images(full).map((p) => p.label)).toEqual(["Picture 1:", "Picture 1 with the user's paint on it, numbered by mark:"]);
    expect(full.text.endsWith("The user's notes, by mark:\n1. Remove this person.\n2. Make this one bigger.")).toBe(true);
    const budget = await context(page, { images: "budget" });
    expect(images(budget).map((p) => p.label)).toEqual(["Picture 1, the part of mark 1:", "Picture 1, the part of mark 2:"]);
  });

  test("undo takes the last mark away; its paint and its number go", async ({ page }) => {
    await setup(page, "article.html", { look: "none" });
    await paintPhrase(page, "#why + p + p", "6.7 ms");
    await page.evaluate(() => window.brush.note(window.brush.marks()[0]!.id, "Is this right?"));
    await paintPhrase(page, "#budget + p", "16.7 ms");
    await expect.poll(() => badges(page)).toEqual(["1", "2"]);
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() => window.brush.marks().map((m) => m.n))).toEqual([1]);
    await expect.poll(() => badges(page)).toEqual(["1"]);
    const c = await context(page, { around: 0 });
    expect(c.text.endsWith("The user's notes, by mark:\n1. Is this right?")).toBe(true);
  });
});

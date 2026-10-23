import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Loads the real extension. Branded Chrome no longer loads unpacked extensions from the
// command line, so these run in Edge. A test cannot press the toolbar button or the browser
// shortcut, which is what grants the extension the tab, so the test copy has page access.
async function launch(): Promise<{ context: BrowserContext; id: string; toggle: (url: string) => Promise<unknown> }> {
  const dir = mkdtempSync(join(tmpdir(), "ws-ext-"));
  const ext = join(dir, "extension");
  cpSync(resolve("extension"), ext, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  manifest.permissions.push("tabs");
  writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(dir, "profile"), {
    channel: "msedge",
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // What the shortcut does, in plain JavaScript so the test's compiler cannot add helpers the
  // worker does not have.
  const toggle = (url: string) =>
    worker.evaluate(`(async () => {
      const tab = (await chrome.tabs.query({})).find((t) => (t.url || "").includes(${JSON.stringify(url)}));
      const [{ result: loaded }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => typeof window.webSelection !== "undefined" });
      if (!loaded) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (window.webSelection.toggle(), window.webSelection.enabled) });
      return result;
    })()`);
  return { context, id: new URL(worker.url()).host, toggle };
}

const hudCount = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.querySelector("web-selection-brush")?.shadowRoot?.querySelector(".hud .count")?.textContent ?? null);

test("the panel shows the shortcut and opens the browser's shortcut settings", async ({}, info) => {
  test.skip(info.project.name !== "edge", "Only Edge can load an unpacked extension from the command line");
  const { context, id } = await launch();
  try {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/popup.html`);
    await expect(panel.locator("#keys kbd")).toHaveText(["Alt", "Shift", "S"]);
    await expect(panel.locator(".look")).toHaveCount(0);
    const opened = context.waitForEvent("page");
    await panel.locator("#change").click();
    const settings = await opened;
    await expect.poll(() => settings.url()).toContain("extensions/shortcuts");
  } finally {
    await context.close();
  }
});

test("the extension paints on a page and the painted text jitters", async ({}, info) => {
  test.skip(info.project.name !== "edge", "Only Edge can load an unpacked extension from the command line");
  const { context, toggle } = await launch();
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:5199/tests/fixtures/article.html");
    expect(await toggle("article.html")).toBe(true);
    await expect.poll(() => hudCount(page)).toBe("Paint over the page to select");
    // The page's own scripts cannot see the brush.
    expect(await page.evaluate(() => typeof window.webSelection)).toBe("undefined");
    await page.locator("#budget + p").scrollIntoViewIfNeeded();
    const p = (await page.locator("#budget + p").boundingBox())!;
    await page.mouse.move(p.x + 40, p.y + 12);
    await page.mouse.down();
    await page.mouse.move(p.x + 200, p.y + 12, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => hudCount(page)).toBe("1 selected");
    await expect(page.locator("#budget + p")).toHaveAttribute("data-ws-look", "jitter");
    expect(await toggle("article.html")).toBe(false);
  } finally {
    await context.close();
  }
});

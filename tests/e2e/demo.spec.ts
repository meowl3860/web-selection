import { expect, test } from "@playwright/test";

// The example page with its note box: paint, type a note, and see it in what a model gets.
test("in the example, a note typed after a stroke goes into the context", async ({ page }, info) => {
  test.skip(info.project.name !== "chrome", "The example is the same in both browsers");
  await page.goto("http://localhost:5199/examples/");
  await page.keyboard.press("b");
  const p = page.locator("article > p").nth(2);
  await p.scrollIntoViewIfNeeded();
  const b = (await p.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 12);
  await page.mouse.down();
  await page.mouse.move(b.x + 220, b.y + 12, { steps: 8 });
  await page.mouse.up();
  const note = page.locator("web-selection-note .box");
  await expect(note).toBeVisible();
  await expect(note.locator(".n")).toHaveText("1");
  // The brush's own keys still work while the box is open, and do not go into the note.
  await page.keyboard.press("]");
  await expect(note.locator("input")).toHaveValue("");
  await page.keyboard.type("Explain this simply");
  await expect(note.locator("input")).toHaveValue("Explain this simply");
  await page.keyboard.press("Enter");
  await expect(note).toBeHidden();
  await expect(page.locator("#output")).toContainText("The user's notes, by mark:\n1. Explain this simply");
});

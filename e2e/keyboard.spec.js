import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// Regression coverage for docs/TASKS.md P0-7.
test.describe("keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await page.waitForSelector("#container canvas");
  });

  async function addCircleAndSelect(page) {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    const box = await page.locator("#container").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  test("Delete removes the selected shape", async ({ page }) => {
    await addCircleAndSelect(page);
    await expect
      .poll(() => page.evaluate(() => !!window.canvasManager.selectedShape))
      .toBe(true);

    await page.keyboard.press("Delete");

    const count = await page.evaluate(() => window.canvasManager.shapes.length);
    expect(count).toBe(0);
  });

  test("Backspace while the selection is a shape also removes it", async ({
    page,
  }) => {
    await addCircleAndSelect(page);
    await page.keyboard.press("Backspace");
    const count = await page.evaluate(() => window.canvasManager.shapes.length);
    expect(count).toBe(0);
  });

  test("Backspace while typing in the properties panel does NOT delete the shape", async ({
    page,
  }) => {
    await addCircleAndSelect(page);
    await page.fill("#itemName", "my circle");
    await page.focus("#itemName");
    await page.keyboard.press("Backspace");

    const count = await page.evaluate(() => window.canvasManager.shapes.length);
    expect(count).toBe(1);
  });

  test("Escape deselects and switches back to the select tool", async ({
    page,
  }) => {
    await addCircleAndSelect(page);
    await page.click("#pencilTool");
    expect(await page.evaluate(() => window.toolManager.getTool())).toBe(
      "pen"
    );

    await page.keyboard.press("Escape");

    expect(await page.evaluate(() => window.toolManager.getTool())).toBe(
      "cursor"
    );
    expect(
      await page.evaluate(() => !!window.canvasManager.selectedShape)
    ).toBe(false);
  });

  test("Ctrl+Z / Ctrl+Shift+Z undo and redo a shape add", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    await page.keyboard.press("Control+z");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(0);

    await page.keyboard.press("Control+Shift+Z");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
  });
});

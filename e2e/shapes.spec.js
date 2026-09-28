import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// Regression coverage for docs/TASKS.md P0-6: the shapes menu had
// buttons wired to nonexistent methods (Arrow), methods with no wired
// button (Rectangle), and a working button+method pair that were never
// connected to each other (Star).
test.describe("shapes menu", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await page.waitForSelector("#container canvas");
  });

  for (const [buttonId, expectedClassName] of [
    ["addSquare", "Rect"],
    ["addRectangle", "Rect"],
    ["addCircle", "Circle"],
    ["addTriangle", "RegularPolygon"],
    ["addStar", "Star"],
  ]) {
    test(`${buttonId} adds a ${expectedClassName} to the canvas`, async ({
      page,
    }) => {
      await page.click("#shapesTool");
      await page.click(`#${buttonId}`);
      const result = await page.evaluate(
        () => window.canvasManager.shapes.at(-1)?.getClassName()
      );
      expect(result).toBe(expectedClassName);
    });
  }

  test("addLine (top row, outside the grid) adds a Line", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addLine");
    const result = await page.evaluate(
      () => window.canvasManager.shapes.at(-1)?.getClassName()
    );
    expect(result).toBe("Line");
  });

  test("unimplemented Phase 3 shape buttons are hidden, not dead", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    for (const id of [
      "addArrow",
      "addPolyline",
      "addCurvedArrow",
      "addRoundedSquare",
      "addDiamond",
      "addSpeechBubble",
      "addArrowedBox",
    ]) {
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
  });
});

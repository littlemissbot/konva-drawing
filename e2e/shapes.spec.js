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
    await expect(page.locator("#container canvas").first()).toBeVisible();
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
      const result = await page.evaluate(() =>
        window.canvasManager.shapes.at(-1)?.getClassName()
      );
      expect(result).toBe(expectedClassName);
    });
  }

  test("addLine (top row, outside the grid) adds a Line", async ({ page }) => {
    await page.click("#shapesTool");
    await page.click("#addLine");
    const result = await page.evaluate(() =>
      window.canvasManager.shapes.at(-1)?.getClassName()
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

  // Regression test for docs/TASKS.md P0-10: consolidating ShapeManager
  // onto CanvasManager's single setupShapeEvents also wired up the same
  // hover tooltip SVG icons already had (previously basic shapes had no
  // tooltip at all - the "name" parameter every caller already passed
  // was silently unused). This confirms the wiring doesn't throw for a
  // basic shape, the same way persistence.spec.js already covers icons.
  test("hovering a basic shape does not throw", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      c.fire("mouseover", {}, true);
      c.fire("mouseout", {}, true);
    });

    expect(pageErrors).toEqual([]);
  });
});

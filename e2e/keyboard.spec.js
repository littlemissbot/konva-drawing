import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// Regression coverage for docs/TASKS.md P0-7.
test.describe("keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
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
    expect(await page.evaluate(() => window.toolManager.getTool())).toBe("pen");

    await page.keyboard.press("Escape");

    expect(await page.evaluate(() => window.toolManager.getTool())).toBe(
      "cursor"
    );
    expect(
      await page.evaluate(() => !!window.canvasManager.selectedShape)
    ).toBe(false);
  });

  test("Ctrl+Z / Ctrl+Shift+Z undo and redo a shape add", async ({ page }) => {
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

  // Regression test for docs/TASKS.md P0-10: ShapeManager (used by every
  // basic shape - circle, rect, square, triangle, star, line - created
  // from the shapes menu) had its own copy of setupShapeEvents that was
  // missing the dragend -> "shapeDragEnded" emission CanvasManager's
  // copy has. shapeDragEnded is what commits a drag to the undo history,
  // so dragging any of these shapes never created an undo checkpoint for
  // the move: pressing Ctrl+Z afterward undid the shape's *creation*
  // instead, deleting it outright instead of moving it back.
  test("undoing a drag moves the shape back, it does not delete it", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    const original = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });

    const statesBeforeDrag = await page.evaluate(
      () => window.historyManager.states.length
    );
    await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      c.position({ x: c.x() + 150, y: c.y() + 80 });
      c.fire("dragmove", {}, true);
      c.fire("dragend", {}, true);
    });
    // The history commit on drag end is debounced; poll for it rather
    // than trust a fixed sleep to outlast that debounce.
    await expect
      .poll(() => page.evaluate(() => window.historyManager.states.length))
      .toBe(statesBeforeDrag + 1);

    await page.keyboard.press("Control+z");

    const afterUndo = await page.evaluate(() => {
      const shapes = window.canvasManager.shapes;
      const c = shapes[0];
      return { shapeCount: shapes.length, x: c?.x(), y: c?.y() };
    });
    expect(afterUndo.shapeCount).toBe(1);
    expect(afterUndo.x).toBe(original.x);
    expect(afterUndo.y).toBe(original.y);
  });
});

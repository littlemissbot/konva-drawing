import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-1: multi-select.
test.describe("multi-select", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  // Both shapes are created at the stage's center by default (see
  // ShapeManager), so the second one is moved apart via its own
  // Konva API immediately after creation - the same technique
  // e2e/keyboard.spec.js's drag-undo test already uses - rather than
  // clicking at an offset that might miss a shape's actual bounds.
  async function addTwoCirclesApart(page) {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    await page.evaluate(() => {
      const [, second] = window.canvasManager.shapes;
      second.position({ x: second.x() + 200, y: second.y() + 150 });
    });
    return page.evaluate(() => {
      const [first, second] = window.canvasManager.shapes;
      return {
        first: { x: first.x(), y: first.y() },
        second: { x: second.x(), y: second.y() },
      };
    });
  }

  // page.mouse.click() has no `modifiers` option (that belongs to the
  // element-based page.click()/locator.click() APIs) - passing one is
  // silently ignored, so shift-clicking here means actually holding
  // Shift down via the keyboard API around a plain mouse click instead.
  async function clickStagePoint(page, x, y, { shift = false } = {}) {
    const box = await page.locator("#container").boundingBox();
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(box.x + x, box.y + y);
    if (shift) await page.keyboard.up("Shift");
  }

  test("shift-click adds a second shape to the selection without deselecting the first", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);

    await clickStagePoint(page, first.x, first.y);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(1);

    await clickStagePoint(page, second.x, second.y, { shift: true });

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(2);
  });

  test("shift-clicking an already-selected shape removes it from the selection", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);

    await clickStagePoint(page, first.x, first.y);
    await clickStagePoint(page, second.x, second.y, { shift: true });
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);

    await clickStagePoint(page, first.x, first.y, { shift: true });

    const remaining = await page.evaluate(() =>
      window.canvasManager.selectedShapes.map((s) => s.x())
    );
    expect(remaining).toEqual([second.x]);
  });

  test("Ctrl+A selects every shape on the canvas", async ({ page }) => {
    await addTwoCirclesApart(page);

    await page.keyboard.press("Control+a");

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(2);
  });

  test("the transformer wraps every selected shape", async ({ page }) => {
    await addTwoCirclesApart(page);
    await page.keyboard.press("Control+a");

    const nodeCount = await page.evaluate(
      () => window.canvasManager.transformer?.nodes().length
    );
    expect(nodeCount).toBe(2);
  });

  test("Delete removes every selected shape in one step, undoable in one step", async ({
    page,
  }) => {
    await addTwoCirclesApart(page);
    await page.keyboard.press("Control+a");

    await page.keyboard.press("Delete");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(0);

    await page.keyboard.press("Control+z");
    const afterUndo = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(afterUndo).toBe(2);
  });

  test("dragging one selected shape moves the rest of the selection together", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);

    await clickStagePoint(page, first.x, first.y);
    await clickStagePoint(page, second.x, second.y, { shift: true });
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);

    const box = await page.locator("#container").boundingBox();
    await page.mouse.move(box.x + first.x, box.y + first.y);
    await page.mouse.down();
    await page.mouse.move(box.x + first.x + 40, box.y + first.y + 30, {
      steps: 5,
    });
    await page.mouse.up();

    const positions = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => ({ x: s.x(), y: s.y() }))
    );
    // The dragged shape actually moved (a real simulated mouse drag
    // isn't pixel-exact, hence a loose bound rather than an exact delta).
    const draggedDx = positions[0].x - first.x;
    const draggedDy = positions[0].y - first.y;
    expect(Math.abs(draggedDx)).toBeGreaterThan(20);
    expect(Math.abs(draggedDy)).toBeGreaterThan(15);
    // The other selected shape followed by exactly the same delta,
    // whatever it was - not left behind, and not just approximately
    // near it.
    expect(positions[1].x - second.x).toBeCloseTo(draggedDx, 0);
    expect(positions[1].y - second.y).toBeCloseTo(draggedDy, 0);
  });

  test("Escape clears a multi-selection", async ({ page }) => {
    await addTwoCirclesApart(page);
    await page.keyboard.press("Control+a");
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);

    await page.keyboard.press("Escape");

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(0);
  });
});

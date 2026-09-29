import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-7: lock/unlock - locked objects skip the transformer
// and drag.
test.describe("lock / unlock", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  async function addCircleAndSelectIt(page) {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const box = await page.locator("#container").boundingBox();
    const original = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    await page.mouse.click(box.x + original.x, box.y + original.y);
    await expect
      .poll(() => page.evaluate(() => !!window.canvasManager.selectedShape))
      .toBe(true);
    return original;
  }

  test("Ctrl+L locks the selected shape: it can no longer be dragged, and the transformer drops it", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("Control+l");

    const [locked, draggable, transformerNodes] = await page.evaluate(() => [
      window.canvasManager.shapes[0].getAttr("locked"),
      window.canvasManager.shapes[0].draggable(),
      window.canvasManager.transformer.nodes().length,
    ]);
    expect(locked).toBe(true);
    expect(draggable).toBe(false);
    expect(transformerNodes).toBe(0);

    // A real drag attempt does not move it.
    const box = await page.locator("#container").boundingBox();
    await page.mouse.move(box.x + original.x, box.y + original.y);
    await page.mouse.down();
    await page.mouse.move(box.x + original.x + 60, box.y + original.y + 40, {
      steps: 5,
    });
    await page.mouse.up();

    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    expect(position).toEqual(original);
  });

  test("a locked shape stays selectable, and Delete does not remove it", async ({
    page,
  }) => {
    await addCircleAndSelectIt(page);
    await page.keyboard.press("Control+l");

    await page.keyboard.press("Delete");

    const [shapeCount, stillSelected] = await page.evaluate(() => [
      window.canvasManager.shapes.length,
      !!window.canvasManager.selectedShape,
    ]);
    expect(shapeCount).toBe(1);
    expect(stillSelected).toBe(true);
  });

  test("Ctrl+L again unlocks it, restoring drag and the transformer", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);
    await page.keyboard.press("Control+l");

    await page.keyboard.press("Control+l");

    const [locked, draggable] = await page.evaluate(() => [
      window.canvasManager.shapes[0].getAttr("locked"),
      window.canvasManager.shapes[0].draggable(),
    ]);
    expect(locked).toBe(false);
    expect(draggable).toBe(true);

    const box = await page.locator("#container").boundingBox();
    await page.mouse.move(box.x + original.x, box.y + original.y);
    await page.mouse.down();
    await page.mouse.move(box.x + original.x + 60, box.y + original.y + 40, {
      steps: 5,
    });
    await page.mouse.up();

    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    expect(position).not.toEqual(original);
  });

  test("a lock applied while the pen tool is active still blocks dragging after switching back to the cursor", async ({
    page,
  }) => {
    await addCircleAndSelectIt(page);
    await page.keyboard.press("Control+l");

    await page.click("#pencilTool");
    await page.click("#selectTool");

    const draggable = await page.evaluate(() =>
      window.canvasManager.shapes[0].draggable()
    );
    expect(draggable).toBe(false);
  });

  test("locking is undoable in one Ctrl+Z", async ({ page }) => {
    await addCircleAndSelectIt(page);

    await page.keyboard.press("Control+l");
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.shapes[0].getAttr("locked"))
      )
      .toBe(true);

    await page.keyboard.press("Control+z");
    await expect
      .poll(() =>
        page.evaluate(() => !!window.canvasManager.shapes[0].getAttr("locked"))
      )
      .toBe(false);
  });
});

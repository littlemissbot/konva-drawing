import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-5: arrow-key nudge (1px, or 10px with Shift held).
test.describe("arrow-key nudge", () => {
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

  test("ArrowRight/ArrowDown move the selected shape by 1px each", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");

    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    expect(position).toEqual({ x: original.x + 1, y: original.y + 1 });
  });

  test("ArrowLeft/ArrowUp move the selected shape by -1px each", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");

    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    expect(position).toEqual({ x: original.x - 1, y: original.y - 1 });
  });

  test("Shift+ArrowRight moves the selected shape by 10px", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("Shift+ArrowRight");

    const x = await page.evaluate(() => window.canvasManager.shapes[0].x());
    expect(x).toBe(original.x + 10);
  });

  test("nudging a multi-selection moves every selected shape together", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    await page.evaluate(() => {
      const [, second] = window.canvasManager.shapes;
      second.position({ x: second.x() + 100, y: second.y() });
    });
    const originals = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => ({ x: s.x(), y: s.y() }))
    );

    await page.keyboard.press("Control+a");
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);

    await page.keyboard.press("ArrowRight");

    const positions = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => ({ x: s.x(), y: s.y() }))
    );
    expect(positions).toEqual([
      { x: originals[0].x + 1, y: originals[0].y },
      { x: originals[1].x + 1, y: originals[1].y },
    ]);
  });

  test("an arrow key with nothing selected does not move anything", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const original = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });

    await page.keyboard.press("ArrowRight");

    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    expect(position).toEqual(original);
  });

  test("arrow keys while typing in the properties panel do not nudge the shape", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);
    await page.fill("#itemName", "");
    await page.focus("#itemName");

    await page.keyboard.press("ArrowRight");

    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    expect(position).toEqual(original);
  });

  test("a nudge is undoable in one step even after several presses", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);
    const statesBeforeNudge = await page.evaluate(
      () => window.historyManager.states.length
    );

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes[0].x()))
      .toBe(original.x + 3);

    // The history commit is debounced (main.js's debouncedHistoryCommit)
    // so the three presses above land in one undo step, not three - wait
    // for that debounce to actually fire (one new state, not one per
    // press) before undoing, the same pattern e2e/keyboard.spec.js's own
    // drag-undo regression test uses.
    await expect
      .poll(() => page.evaluate(() => window.historyManager.states.length))
      .toBe(statesBeforeNudge + 1);

    await page.keyboard.press("Control+z");

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes[0].x()))
      .toBe(original.x);
  });
});

import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-2: marquee (rubber-band) select.
test.describe("marquee select", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  // Both circles default to the stage's center (see ShapeManager); the
  // second is moved apart right after creation, same technique
  // e2e/selection.spec.js already uses.
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
      second.position({ x: second.x() + 300, y: second.y() + 200 });
    });
    return page.evaluate(() => {
      const [first, second] = window.canvasManager.shapes;
      return {
        first: { x: first.x(), y: first.y() },
        second: { x: second.x(), y: second.y() },
      };
    });
  }

  async function dragMarquee(page, from, to, { shift = false } = {}) {
    const box = await page.locator("#container").boundingBox();
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 5 });
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  }

  test("dragging a box around both shapes selects both", async ({ page }) => {
    const { first, second } = await addTwoCirclesApart(page);

    await dragMarquee(
      page,
      { x: first.x - 40, y: first.y - 40 },
      { x: second.x + 40, y: second.y + 40 }
    );

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(2);
  });

  test("a marquee that only reaches one shape selects just that one", async ({
    page,
  }) => {
    const { first } = await addTwoCirclesApart(page);

    await dragMarquee(
      page,
      { x: first.x - 40, y: first.y - 40 },
      { x: first.x + 40, y: first.y + 40 }
    );

    const positions = await page.evaluate(() =>
      window.canvasManager.selectedShapes.map((s) => ({ x: s.x(), y: s.y() }))
    );
    expect(positions).toEqual([{ x: first.x, y: first.y }]);
  });

  test("a marquee over empty space selects nothing and clears any prior selection", async ({
    page,
  }) => {
    const { first } = await addTwoCirclesApart(page);
    await page.mouse.click(
      (await page.locator("#container").boundingBox()).x + first.x,
      (await page.locator("#container").boundingBox()).y + first.y
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(1);

    // (100,100)-(160,160): clear of both circles and of the floating
    // logo in the page's actual top-left corner (confirmed with
    // document.elementFromPoint - (5,5)-(60,60) landed partly on that
    // logo image, not the canvas, which silently broke this test rather
    // than testing anything real).
    await dragMarquee(page, { x: 100, y: 100 }, { x: 160, y: 160 });

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(0);
  });

  test("shift-dragging a marquee unions into the existing selection instead of replacing it", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);
    const containerBox = await page.locator("#container").boundingBox();
    await page.mouse.click(containerBox.x + first.x, containerBox.y + first.y);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(1);

    // A marquee around just the second shape, with Shift held.
    await dragMarquee(
      page,
      { x: second.x - 40, y: second.y - 40 },
      { x: second.x + 40, y: second.y + 40 },
      { shift: true }
    );

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(2);
  });

  test("a tiny drag (jitter) below the marquee threshold behaves like a plain click - it deselects rather than drawing a marquee", async ({
    page,
  }) => {
    const { first } = await addTwoCirclesApart(page);
    const containerBox = await page.locator("#container").boundingBox();
    await page.mouse.click(containerBox.x + first.x, containerBox.y + first.y);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(1);

    // A 1px jitter, away from any shape, well under MARQUEE_MIN_DRAG.
    await page.mouse.move(containerBox.x + 20, containerBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(containerBox.x + 21, containerBox.y + 20);
    await page.mouse.up();

    const count = await page.evaluate(
      () => window.canvasManager.selectedShapes.length
    );
    expect(count).toBe(0);
  });

  test("the marquee rectangle itself is removed from the canvas after releasing", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);

    await dragMarquee(
      page,
      { x: first.x - 40, y: first.y - 40 },
      { x: second.x + 40, y: second.y + 40 }
    );

    const guidesLayerChildren = await page.evaluate(
      () => window.canvasManager.stage.getLayers()[1].children.length
    );
    expect(guidesLayerChildren).toBe(0);
  });
});

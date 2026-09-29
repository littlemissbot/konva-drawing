import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-8: z-order (bring to front/forward, send backward/to
// back).
test.describe("z-order", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  // Two partially-overlapping, opaque, differently-colored rectangles:
  // whichever is on top fully covers the other in the overlap region, so
  // reading that region's real rendered pixel (not just the internal
  // canvasManager.shapes array order) proves the visual stacking
  // actually changed - exactly the gap a unit test against Konva's
  // object model alone can't close (see docs/TASKS.md's own P2-8 write-
  // up: the first draft's mainLayer.add(shape) resync silently did
  // nothing, since Konva's Container.add() no-ops for a child that's
  // already in the same layer). Each rect also gets its own *exclusive*
  // corner, outside the overlap, so a click there unambiguously selects
  // that one rect regardless of which is currently on top.
  async function addOverlappingRects(page) {
    await page.click("#shapesTool");
    await page.click("#addRectangle");
    await page.click("#shapesTool");
    await page.click("#addRectangle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    return page.evaluate(() => {
      const [bottom, top] = window.canvasManager.shapes;
      bottom.setAttrs({
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: "#ff0000",
      });
      top.setAttrs({
        x: 150,
        y: 150,
        width: 100,
        height: 100,
        fill: "#0000ff",
      });
      window.canvasManager.mainLayer.batchDraw();
      return {
        redOwnCorner: { x: 110, y: 110 },
        blueOwnCorner: { x: 240, y: 240 },
        overlap: { x: 170, y: 170 },
      };
    });
  }

  async function colorAt(page, point) {
    return page.evaluate((p) => {
      const canvas = window.canvasManager.mainLayer.toCanvas();
      const [r, g, b] = canvas
        .getContext("2d")
        .getImageData(p.x, p.y, 1, 1).data;
      return [r, g, b];
    }, point);
  }

  async function clickAt(page, point) {
    const box = await page.locator("#container").boundingBox();
    await page.mouse.click(box.x + point.x, box.y + point.y);
  }

  test("Ctrl+Shift+] brings the selected (bottom) rectangle in front of the other", async ({
    page,
  }) => {
    const { redOwnCorner, overlap } = await addOverlappingRects(page);
    // Blue (added second, on top) covers red at the overlap point.
    expect(await colorAt(page, overlap)).toEqual([0, 0, 255]);

    await clickAt(page, redOwnCorner);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShape?.fill())
      )
      .toBe("#ff0000");

    await page.keyboard.press("Control+Shift+]");

    expect(await colorAt(page, overlap)).toEqual([255, 0, 0]);
    const order = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.fill())
    );
    expect(order).toEqual(["#0000ff", "#ff0000"]);
  });

  test("Ctrl+Shift+[ sends the selected (top) rectangle behind the other", async ({
    page,
  }) => {
    const { blueOwnCorner, overlap } = await addOverlappingRects(page);

    await clickAt(page, blueOwnCorner);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShape?.fill())
      )
      .toBe("#0000ff");

    await page.keyboard.press("Control+Shift+[");

    expect(await colorAt(page, overlap)).toEqual([255, 0, 0]);
  });

  test("Ctrl+] / Ctrl+[ step z-order by one (equivalent to front/back with only 2 shapes)", async ({
    page,
  }) => {
    const { redOwnCorner, overlap } = await addOverlappingRects(page);

    await clickAt(page, redOwnCorner);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShape?.fill())
      )
      .toBe("#ff0000");

    await page.keyboard.press("Control+]"); // bring forward
    expect(await colorAt(page, overlap)).toEqual([255, 0, 0]);

    await page.keyboard.press("Control+["); // send backward - undoes it
    expect(await colorAt(page, overlap)).toEqual([0, 0, 255]);
  });

  test("a z-order change is undoable in one Ctrl+Z", async ({ page }) => {
    const { redOwnCorner, overlap } = await addOverlappingRects(page);
    // addOverlappingRects sets the rects' color/position/size directly
    // via setAttrs(), which doesn't itself commit a history checkpoint
    // (only specific events like shapeAdded/shapeDragEnded do) - without
    // this, the only earlier checkpoint would be from creating the two
    // default-styled rectangles, and undoing the z-order change below
    // would revert to *that* (wrong color/position), not to this test's
    // actual "before" state.
    await page.evaluate(() => window.historyManager.commit());
    await clickAt(page, redOwnCorner);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShape?.fill())
      )
      .toBe("#ff0000");

    await page.keyboard.press("Control+Shift+]");
    await expect.poll(() => colorAt(page, overlap)).toEqual([255, 0, 0]);

    await page.keyboard.press("Control+z");

    await expect.poll(() => colorAt(page, overlap)).toEqual([0, 0, 255]);
  });
});

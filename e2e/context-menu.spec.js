import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-10: right-click context menu (PRD SEL-6), wired to
// clipboard, lock, z-order, align/distribute and group/ungroup.
test.describe("context menu", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  async function addCircle(page) {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const box = await page.locator("#container").boundingBox();
    const position = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    return { box, position };
  }

  test("right-clicking an unselected shape selects it and opens the menu with selection actions enabled", async ({
    page,
  }) => {
    const { box, position } = await addCircle(page);

    await page.mouse.click(box.x + position.x, box.y + position.y, {
      button: "right",
    });

    await expect(page.locator("#contextMenu")).toHaveClass(/open/);
    await expect
      .poll(() => page.evaluate(() => !!window.canvasManager.selectedShape))
      .toBe(true);
    await expect(
      page.locator('#contextMenu [data-item-id="duplicate"]')
    ).toBeEnabled();
    await expect(
      page.locator('#contextMenu [data-item-id="group"]')
    ).toBeDisabled(); // only one shape selected
  });

  test("right-clicking empty canvas opens the menu with everything disabled (no clipboard content yet)", async ({
    page,
  }) => {
    const box = await page.locator("#container").boundingBox();

    await page.mouse.click(box.x + 400, box.y + 300, { button: "right" });

    await expect(page.locator("#contextMenu")).toHaveClass(/open/);
    await expect(
      page.locator('#contextMenu [data-item-id="cut"]')
    ).toBeDisabled();
    await expect(
      page.locator('#contextMenu [data-item-id="paste"]')
    ).toBeDisabled();
  });

  test("clicking Duplicate in the menu duplicates the shape and closes the menu", async ({
    page,
  }) => {
    const { box, position } = await addCircle(page);
    await page.mouse.click(box.x + position.x, box.y + position.y, {
      button: "right",
    });
    await expect(page.locator("#contextMenu")).toHaveClass(/open/);

    await page.click('#contextMenu [data-item-id="duplicate"]');

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    await expect(page.locator("#contextMenu")).not.toHaveClass(/open/);
  });

  test("clicking outside the menu closes it without doing anything", async ({
    page,
  }) => {
    const { box, position } = await addCircle(page);
    await page.mouse.click(box.x + position.x, box.y + position.y, {
      button: "right",
    });
    await expect(page.locator("#contextMenu")).toHaveClass(/open/);

    await page.mouse.click(box.x + 10, box.y + 10);

    await expect(page.locator("#contextMenu")).not.toHaveClass(/open/);
    const shapeCount = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(shapeCount).toBe(1);
  });

  test("Escape closes the menu", async ({ page }) => {
    const { box, position } = await addCircle(page);
    await page.mouse.click(box.x + position.x, box.y + position.y, {
      button: "right",
    });
    await expect(page.locator("#contextMenu")).toHaveClass(/open/);

    await page.keyboard.press("Escape");

    await expect(page.locator("#contextMenu")).not.toHaveClass(/open/);
  });

  test("Group then Ungroup work end-to-end through the menu", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    await page.keyboard.press("Control+a");
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);

    const box = await page.locator("#container").boundingBox();
    const first = await page.evaluate(() => {
      const c = window.canvasManager.shapes[0];
      return { x: c.x(), y: c.y() };
    });
    // Right-clicking a shape that's already part of the current
    // multi-selection must not collapse it down to just that one shape.
    await page.mouse.click(box.x + first.x, box.y + first.y, {
      button: "right",
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);
    await expect(
      page.locator('#contextMenu [data-item-id="group"]')
    ).toBeEnabled();

    await page.click('#contextMenu [data-item-id="group"]');

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.shapes[0].getClassName())
      )
      .toBe("Group");

    await page.mouse.click(box.x + first.x, box.y + first.y, {
      button: "right",
    });
    await expect(
      page.locator('#contextMenu [data-item-id="ungroup"]')
    ).toBeEnabled();

    await page.click('#contextMenu [data-item-id="ungroup"]');

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
  });

  // docs/TASKS.md P2-9's align/distribute have no keyboard shortcut at
  // all (PRD's own Appendix B has none, and they were built against
  // this exact menu as their real UI entry point) - this is their first
  // and only real end-to-end coverage, not just a unit test calling the
  // same method a test would.
  test("Align Left, reached only through the menu, actually moves the selected shapes", async ({
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
      const [a, b] = window.canvasManager.shapes;
      a.setAttrs({ x: 100, y: 100 });
      b.setAttrs({ x: 250, y: 300 });
    });
    await page.keyboard.press("Control+a");
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);

    const box = await page.locator("#container").boundingBox();
    await page.mouse.click(box.x + 100, box.y + 100, { button: "right" });
    await expect(
      page.locator('#contextMenu [data-item-id="alignLeft"]')
    ).toBeEnabled();

    await page.click('#contextMenu [data-item-id="alignLeft"]');

    const [xa, xb] = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getClientRect().x)
    );
    expect(xa).toBeCloseTo(xb, 0);
  });

  test("a menu action is undoable in one Ctrl+Z", async ({ page }) => {
    const { box, position } = await addCircle(page);
    await page.mouse.click(box.x + position.x, box.y + position.y, {
      button: "right",
    });

    await page.click('#contextMenu [data-item-id="lock"]');

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

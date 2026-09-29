import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-6: group/ungroup, double-click to enter a group.
test.describe("group / ungroup", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

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

  async function clickStagePoint(page, x, y, { shift = false } = {}) {
    const box = await page.locator("#container").boundingBox();
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(box.x + x, box.y + y);
    if (shift) await page.keyboard.up("Shift");
  }

  async function selectBoth(page, first, second) {
    await clickStagePoint(page, first.x, first.y);
    await clickStagePoint(page, second.x, second.y, { shift: true });
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(2);
  }

  test("Ctrl+G groups the selection into one object; a plain click on either circle selects the whole group", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);
    await selectBoth(page, first, second);

    await page.keyboard.press("Control+g");

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const className = await page.evaluate(() =>
      window.canvasManager.shapes[0].getClassName()
    );
    expect(className).toBe("Group");

    // Clicking away, then clicking either original circle's position
    // selects the whole group, not an individual child.
    await page.keyboard.press("Escape");
    await clickStagePoint(page, first.x, first.y);
    const selectedIsGroup = await page.evaluate(
      () =>
        window.canvasManager.selectedShape === window.canvasManager.shapes[0]
    );
    expect(selectedIsGroup).toBe(true);
  });

  test("dragging the group moves both circles together", async ({ page }) => {
    const { first, second } = await addTwoCirclesApart(page);
    await selectBoth(page, first, second);
    await page.keyboard.press("Control+g");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    const box = await page.locator("#container").boundingBox();
    await page.mouse.move(box.x + first.x, box.y + first.y);
    await page.mouse.down();
    await page.mouse.move(box.x + first.x + 60, box.y + first.y + 40, {
      steps: 5,
    });
    await page.mouse.up();

    const childPositions = await page.evaluate(() =>
      window.canvasManager.shapes[0]
        .getChildren()
        .map((c) => ({ x: c.x(), y: c.y() }))
    );
    // Children keep their own relative x/y (unchanged - only the group's
    // own transform moved), but the group itself visibly moved.
    const groupPos = await page.evaluate(() => {
      const g = window.canvasManager.shapes[0];
      return { x: g.x(), y: g.y() };
    });
    expect(Math.abs(groupPos.x)).toBeGreaterThan(20);
    expect(Math.abs(groupPos.y)).toBeGreaterThan(15);
    expect(childPositions).toEqual([
      { x: first.x, y: first.y },
      { x: second.x, y: second.y },
    ]);
  });

  test("double-clicking the group enters it, so a click on one circle selects just that circle", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);
    await selectBoth(page, first, second);
    await page.keyboard.press("Control+g");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    const box = await page.locator("#container").boundingBox();
    await page.mouse.dblclick(box.x + first.x, box.y + first.y);
    // The double-click's own two clicks already select the group and
    // re-select it - now click the *other* child to prove entry mode is
    // live, not just an artifact of the click that triggered it.
    await clickStagePoint(page, second.x, second.y);

    const selectedIsChild = await page.evaluate(() => {
      const group = window.canvasManager.shapes[0];
      const selected = window.canvasManager.selectedShape;
      return selected !== group && selected?.getParent() === group;
    });
    expect(selectedIsChild).toBe(true);
  });

  test("Ctrl+Shift+G ungroups, restoring both circles as independent, draggable top-level shapes at their original positions", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);
    await selectBoth(page, first, second);
    await page.keyboard.press("Control+g");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    await page.keyboard.press("Control+Shift+G");

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    const positions = await page.evaluate(() =>
      window.canvasManager.shapes
        .map((s) => ({
          x: s.x(),
          y: s.y(),
          className: s.getClassName(),
          draggable: s.draggable(),
        }))
        .sort((a, b) => a.x - b.x)
    );
    expect(positions).toEqual([
      { x: first.x, y: first.y, className: "Circle", draggable: true },
      { x: second.x, y: second.y, className: "Circle", draggable: true },
    ]);
  });

  test("grouping and ungrouping are each undoable in one Ctrl+Z", async ({
    page,
  }) => {
    const { first, second } = await addTwoCirclesApart(page);
    await selectBoth(page, first, second);

    await page.keyboard.press("Control+g");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    await page.keyboard.press("Control+z");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);

    await page.keyboard.press("Control+Shift+Z"); // redo the group
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    // Undo/redo always clears the selection (main.js's applyCanvasSnapshot
    // calls deselectShape() unconditionally) - re-select the group before
    // trying to ungroup it, the same as a real user would have to click
    // it again after an undo/redo.
    await clickStagePoint(page, first.x, first.y);
    await expect
      .poll(() =>
        page.evaluate(() => window.canvasManager.selectedShapes.length)
      )
      .toBe(1);

    await page.keyboard.press("Control+Shift+G");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);

    await page.keyboard.press("Control+z");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const className = await page.evaluate(() =>
      window.canvasManager.shapes[0].getClassName()
    );
    expect(className).toBe("Group");
  });

  test("a group survives a save/reload round-trip", async ({ page }) => {
    const { first, second } = await addTwoCirclesApart(page);
    await selectBoth(page, first, second);
    await page.keyboard.press("Control+g");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    // Wait for the debounced autosave to actually land in localStorage
    // (same pattern as e2e/persistence.spec.js's own live-edit test)
    // before reloading, rather than assuming a fixed delay is enough.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("canvasData");
          return raw ? JSON.parse(raw).objects?.length : null;
        })
      )
      .toBe(1);

    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    const [className, childCount] = await page.evaluate(() => {
      const g = window.canvasManager.shapes[0];
      return [g.getClassName(), g.getChildren().length];
    });
    expect(className).toBe("Group");
    expect(childCount).toBe(2);
  });
});

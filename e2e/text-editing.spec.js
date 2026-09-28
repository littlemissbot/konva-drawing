import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// Regression coverage for docs/TASKS.md P0-4: the inline text-edit
// textarea sized itself from unscaled logical values, and its one
// scale-aware code path divided by the zoom scale instead of
// multiplying, so editing was visually misaligned at any zoom level
// other than 100%.
test.describe("text editing overlay", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  test("editor position, width and font size match the text node at 100% zoom", async ({
    page,
  }) => {
    await page.click("#textTool");
    const expected = await page.evaluate(() => {
      const t = window.canvasManager.shapes.find(
        (s) => s.getClassName() === "Text"
      );
      window.__textNode = t;
      const abs = t.absolutePosition();
      const stageBox = window.canvasManager.stage
        .container()
        .getBoundingClientRect();
      return {
        screenX: stageBox.left + abs.x,
        screenY: stageBox.top + abs.y,
        width: (t.width() - t.padding() * 2) * 1,
        fontSize: t.fontSize() * 1,
      };
    });

    await page.evaluate(() =>
      window.textManager.startEditing(window.__textNode)
    );
    const actual = await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      const r = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        fontSize: parseFloat(cs.fontSize),
      };
    });

    expect(Math.abs(actual.left - expected.screenX)).toBeLessThan(2);
    expect(Math.abs(actual.top - expected.screenY)).toBeLessThan(2);
    expect(Math.abs(actual.width - expected.width)).toBeLessThan(2);
    expect(Math.abs(actual.fontSize - expected.fontSize)).toBeLessThan(1);
  });

  test("editor position, width and font size match the text node at 200% zoom after panning", async ({
    page,
  }) => {
    await page.click("#textTool");
    for (let i = 0; i < 10; i++) await page.click("#zoomIn"); // +10% each, 100% -> 200%
    await expect(page.locator("#zoomPercentage")).toHaveText("200%");

    await page.evaluate(() => {
      window.canvasManager.stage.position({
        x: window.canvasManager.stage.x() - 137,
        y: window.canvasManager.stage.y() + 63,
      });
      window.canvasManager.stage.batchDraw();
    });

    const expected = await page.evaluate(() => {
      const t = window.canvasManager.shapes.find(
        (s) => s.getClassName() === "Text"
      );
      window.__textNode = t;
      const abs = t.absolutePosition();
      const scale = t.getAbsoluteScale().x;
      const stageBox = window.canvasManager.stage
        .container()
        .getBoundingClientRect();
      return {
        screenX: stageBox.left + abs.x,
        screenY: stageBox.top + abs.y,
        width: (t.width() - t.padding() * 2) * scale,
        fontSize: t.fontSize() * scale,
      };
    });

    await page.evaluate(() =>
      window.textManager.startEditing(window.__textNode)
    );
    const actual = await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      const r = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        fontSize: parseFloat(cs.fontSize),
      };
    });

    expect(Math.abs(actual.left - expected.screenX)).toBeLessThan(2);
    expect(Math.abs(actual.top - expected.screenY)).toBeLessThan(2);
    expect(Math.abs(actual.width - expected.width)).toBeLessThan(3);
    expect(Math.abs(actual.fontSize - expected.fontSize)).toBeLessThan(1);
  });

  test("typing and pressing Enter commits the new text to the node", async ({
    page,
  }) => {
    await page.click("#textTool");
    await page.evaluate(() => {
      window.__textNode = window.canvasManager.shapes.find(
        (s) => s.getClassName() === "Text"
      );
      window.textManager.startEditing(window.__textNode);
    });
    // TextManager focuses the textarea via a deferred setTimeout, not
    // synchronously within startEditing, so typing must wait for real
    // focus rather than assume it landed the instant the function above
    // returned (this raced and flaked without the wait).
    await expect(page.locator("textarea")).toBeFocused();
    await page.keyboard.type(" hello");
    await page.keyboard.press("Enter");

    const committed = await page.evaluate(() => window.__textNode.text());
    expect(committed).toBe("Double click to edit hello");
    await expect(page.locator("textarea")).toHaveCount(0);
  });

  test("Escape cancels editing without committing", async ({ page }) => {
    await page.click("#textTool");
    await page.evaluate(() => {
      window.__textNode = window.canvasManager.shapes.find(
        (s) => s.getClassName() === "Text"
      );
      window.textManager.startEditing(window.__textNode);
    });
    await expect(page.locator("textarea")).toBeFocused();
    await page.keyboard.type(" should not be saved");
    await page.keyboard.press("Escape");

    const text = await page.evaluate(() => window.__textNode.text());
    expect(text).toBe("Double click to edit");
    await expect(page.locator("textarea")).toHaveCount(0);
  });
});

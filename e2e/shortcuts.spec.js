import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-3: tool/shape switches, zoom-to-fit, and the "?"
// Help dialog. Undo/redo/delete/escape/export/import/print are already
// covered by e2e/keyboard.spec.js, e2e/export.spec.js, e2e/print.spec.js.
test.describe("shortcuts (docs/TASKS.md P2-3)", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  test("V/P/N switch tools, matching their toolbar buttons", async ({
    page,
  }) => {
    await page.keyboard.press("p");
    expect(await page.evaluate(() => window.toolManager.getTool())).toBe("pen");

    await page.keyboard.press("n");
    expect(await page.evaluate(() => window.toolManager.getTool())).toBe(
      "note"
    );

    await page.keyboard.press("v");
    expect(await page.evaluate(() => window.toolManager.getTool())).toBe(
      "cursor"
    );
  });

  test("T creates a text node, same as the Text toolbar button", async ({
    page,
  }) => {
    await page.keyboard.press("t");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const className = await page.evaluate(() =>
      window.canvasManager.shapes[0].getClassName()
    );
    expect(className).toBe("Text");
  });

  test("R/O/L create Rectangle/Circle/Line shapes", async ({ page }) => {
    await page.keyboard.press("r");
    await page.keyboard.press("o");
    await page.keyboard.press("l");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(3);
    const classNames = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getClassName())
    );
    expect(classNames).toEqual(["Rect", "Circle", "Line"]);
  });

  test("tool/shape letter shortcuts are suppressed while typing in the properties panel", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.click("#shapesTool");
    await page.click("#addCircle"); // select the shape by clicking it
    const box = await page.locator("#container").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => page.evaluate(() => !!window.canvasManager.selectedShape))
      .toBe(true);

    await page.fill("#itemName", "");
    await page.focus("#itemName");
    await page.keyboard.type("r-o-l are just letters here");

    const shapeCount = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(shapeCount).toBe(2); // unchanged - no new shapes from typing
    await expect(page.locator("#itemName")).toHaveValue(
      "r-o-l are just letters here"
    );
  });

  test("Shift+1 zooms to fit the content, same as the zoom-to-fit button", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    // Zoom in first so there's something for "fit" to visibly undo.
    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    const zoomedIn = await page.evaluate(
      () => document.getElementById("zoomPercentage").textContent
    );

    await page.keyboard.press("Shift+1");

    const afterFit = await page.evaluate(
      () => document.getElementById("zoomPercentage").textContent
    );
    expect(afterFit).not.toBe(zoomedIn);
  });

  test("? opens the Help dialog listing the app's real shortcuts", async ({
    page,
  }) => {
    await page.keyboard.press("?");
    await expect(page.locator("#helpModal")).toBeVisible();
    await expect(page.locator("#helpModalBody")).toContainText("Select tool");
    await expect(page.locator("#helpModalBody")).toContainText("Undo");
    // Ctrl on this (non-Mac) test runner, not the literal "Mod" placeholder.
    await expect(page.locator("#helpModalBody")).toContainText("Ctrl+A");
  });

  test("typing a literal ? into a text field does not open Help", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    const box = await page.locator("#container").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => page.evaluate(() => !!window.canvasManager.selectedShape))
      .toBe(true);

    await page.fill("#itemName", "");
    await page.focus("#itemName");
    await page.keyboard.type("really?");

    await expect(page.locator("#helpModal")).toBeHidden();
    await expect(page.locator("#itemName")).toHaveValue("really?");
  });
});

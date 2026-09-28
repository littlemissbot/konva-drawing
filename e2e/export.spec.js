import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

function legacyOrNewDoc(overrides = {}) {
  return {
    version: 2,
    id: "doc_import_test",
    name: "Imported",
    createdAt: 1,
    updatedAt: 1,
    canvas: { background: null, gridSize: 20, unit: "px" },
    objects: [
      {
        id: "obj_imported_1",
        type: "Rect",
        zIndex: 0,
        attrs: { x: 5, y: 5, width: 10, height: 10, name: "Imported Rect" },
      },
    ],
    ...overrides,
  };
}

test.describe("JSON export / import (docs/TASKS.md P1-7)", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
  });

  test("Ctrl+S downloads the current document as a .framex.json file", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("Untitled.framex.json");
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const doc = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    expect(doc.version).toBe(2);
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0].type).toBe("Circle");
  });

  test("Ctrl+O into an empty canvas imports without prompting for replace/merge", async ({
    page,
  }) => {
    await page.goto("/canvas.html");

    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "drawing.framex.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacyOrNewDoc())),
    });

    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas imported"
    );
    const shapes = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getAttr("name"))
    );
    expect(shapes).toEqual(["Imported Rect"]);
  });

  test("importing into a non-empty canvas prompts; accepting replaces everything", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    page.once("dialog", (d) => d.accept()); // OK -> replace

    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "drawing.framex.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacyOrNewDoc())),
    });

    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas imported"
    );
    const shapes = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getAttr("name"))
    );
    expect(shapes).toEqual(["Imported Rect"]);

    // Ctrl+Z after a replace-import goes back to the pre-import canvas
    // in one step (both a before and after checkpoint are committed).
    await page.keyboard.press("Control+z");
    const afterUndo = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getClassName())
    );
    expect(afterUndo).toEqual(["Circle"]);
  });

  test("importing into a non-empty canvas; cancelling merges instead of replacing", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    page.once("dialog", (d) => d.dismiss()); // Cancel -> merge

    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "drawing.framex.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacyOrNewDoc())),
    });

    await expect(page.locator(".save-status-text")).toHaveText("Canvas merged");
    const shapes = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getClassName())
    );
    expect(shapes.sort()).toEqual(["Circle", "Rect"]);
  });

  test("dropping a .json file onto the canvas imports it (drag-and-drop)", async ({
    page,
  }) => {
    await page.goto("/canvas.html");

    await page.evaluate((docJson) => {
      const file = new File([docJson], "dropped.framex.json", {
        type: "application/json",
      });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const container = document.getElementById("container");
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      container.dispatchEvent(event);
    }, JSON.stringify(legacyOrNewDoc()));

    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas imported"
    );
    const shapes = await page.evaluate(() =>
      window.canvasManager.shapes.map((s) => s.getAttr("name"))
    );
    expect(shapes).toEqual(["Imported Rect"]);
  });

  test("importing an invalid file shows an error and leaves the canvas unchanged", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    let dialogMessage = null;
    page.once("dialog", (d) => {
      dialogMessage = d.message();
      d.accept();
    });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("not json"),
    });

    await expect.poll(() => dialogMessage).not.toBeNull();
    expect(dialogMessage).toContain("bad.json");
    const shapeCount = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(shapeCount).toBe(1);
  });
});

import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// docs/TASKS.md P2-4: copy/cut/paste/duplicate with offset; system image
// paste; plain-text paste creates text.
test.describe("clipboard", () => {
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

  test("Ctrl+C then Ctrl+V pastes an offset copy and selects it, leaving the original untouched", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    const [ids, selected] = await page.evaluate(() => [
      window.canvasManager.shapes.map((s) => s.id()),
      {
        id: window.canvasManager.selectedShape.id(),
        x: window.canvasManager.selectedShape.x(),
        y: window.canvasManager.selectedShape.y(),
      },
    ]);
    expect(new Set(ids).size).toBe(2); // pasted shape got its own id
    expect(selected.x).toBe(original.x + 20);
    expect(selected.y).toBe(original.y + 20);
  });

  test("pasting twice offsets each paste from the copied shape, not cumulatively", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Control+v");

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(3);
    const pastedXs = await page.evaluate(() =>
      window.canvasManager.shapes.slice(1).map((s) => s.x())
    );
    expect(pastedXs).toEqual([original.x + 20, original.x + 20]);
  });

  test("Ctrl+X removes the shape; Ctrl+V brings it back", async ({ page }) => {
    const original = await addCircleAndSelectIt(page);

    await page.keyboard.press("Control+x");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(0);

    await page.keyboard.press("Control+v");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const pasted = await page.evaluate(() => {
      const s = window.canvasManager.shapes[0];
      return { x: s.x(), y: s.y() };
    });
    expect(pasted.x).toBe(original.x + 20);
    expect(pasted.y).toBe(original.y + 20);
  });

  test("Ctrl+D duplicates the selection in place with an offset, without touching a previous real copy", async ({
    page,
  }) => {
    const original = await addCircleAndSelectIt(page);
    // A real copy of the original shape, made before duplicating -
    // duplicating a *different* shape below must not clobber this.
    await page.keyboard.press("Control+c");

    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(2);
    const box = await page.locator("#container").boundingBox();
    const second = await page.evaluate(() => {
      const c = window.canvasManager.shapes[1];
      return { x: c.x(), y: c.y() };
    });
    await page.mouse.click(box.x + second.x, box.y + second.y);
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.selectedShape?.x()))
      .toBe(second.x);

    await page.keyboard.press("Control+d");

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(3);
    const duplicate = await page.evaluate(() => {
      const s = window.canvasManager.selectedShape;
      return { x: s.x(), y: s.y() };
    });
    expect(duplicate.x).toBe(second.x + 20);
    expect(duplicate.y).toBe(second.y + 20);

    // The earlier Ctrl+C of the original shape still pastes that shape,
    // not the duplicated one.
    await page.keyboard.press("Control+v");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(4);
    const fromRealCopy = await page.evaluate(() => {
      const s = window.canvasManager.selectedShape;
      return { x: s.x(), y: s.y() };
    });
    expect(fromRealCopy.x).toBe(original.x + 20);
    expect(fromRealCopy.y).toBe(original.y + 20);
  });

  // System image paste: a real "paste" DOM event carrying an image file,
  // the same shape browsers give clipboardData for an image copied from
  // outside the app (a screenshot, another program). Constructed here
  // rather than via a real OS clipboard, which Playwright/CI has no
  // reliable way to seed with actual image bytes.
  test("pasting an image copied from outside the app creates an Image shape", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const file = new File([bytes], "pasted.png", { type: "image/png" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const event = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
    });

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const [className, imageSrc] = await page.evaluate(() => {
      const shape = window.canvasManager.shapes[0];
      return [shape.getClassName(), shape.getAttr("imageSrc")];
    });
    expect(className).toBe("Image");
    expect(imageSrc).toMatch(/^data:image\/png;base64,/);
  });

  // Plain-text paste creates a Text shape (docs/TASKS.md P2-4) - the
  // other half of "paste something from outside the app" this task adds.
  test("pasting plain text creates a Text shape pre-filled with it", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", "pasted from outside");
      const event = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
    });

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const [className, text] = await page.evaluate(() => {
      const shape = window.canvasManager.shapes[0];
      return [shape.getClassName(), shape.text()];
    });
    expect(className).toBe("Text");
    expect(text).toBe("pasted from outside");
  });

  // Pasting into a real input field (e.g. the properties panel's Name
  // field) must behave natively, never get hijacked into pasting shapes
  // onto the canvas - the same `typing` gate every other shortcut uses.
  test("pasting plain text into the properties panel's Name field does not create a shape", async ({
    page,
  }) => {
    await addCircleAndSelectIt(page);
    await page.fill("#itemName", "");
    await page.focus("#itemName");

    await page.evaluate(() => {
      const input = document.getElementById("itemName");
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", "not a shape");
      const event = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
    });

    const shapeCount = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(shapeCount).toBe(1); // still just the original circle
  });
});

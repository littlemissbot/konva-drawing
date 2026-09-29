import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

test.describe("Export dialog (docs/TASKS.md P1-8)", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await page.goto("/canvas.html");
    await expect(page.locator("#container canvas").first()).toBeVisible();
  });

  test("Ctrl+E opens the dialog and shows the empty-canvas preview state", async ({
    page,
  }) => {
    await page.keyboard.press("Control+e");
    await expect(page.locator("#exportModal")).toBeVisible();
    await expect(page.locator("#exportPreviewEmpty")).toBeVisible();
    await expect(page.locator("#exportPreviewEmpty")).toHaveText(
      "Nothing to export"
    );
  });

  test("the Export toolbar button also opens the dialog", async ({ page }) => {
    await page.click("#exportBtn");
    await expect(page.locator("#exportModal")).toBeVisible();
  });

  test("adding a shape and opening the dialog shows a live preview image, not the empty state", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Control+e");
    await expect(page.locator("#exportPreviewImg")).toBeVisible();
    await expect(page.locator("#exportPreviewEmpty")).toBeHidden();
    const src = await page.locator("#exportPreviewImg").getAttribute("src");
    expect(src).toMatch(/^data:image\/png/);
  });

  test("switching format hides/shows the format-specific options", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Control+e");

    // PNG (default): transparent toggle visible, PDF options hidden.
    await expect(page.locator("#exportTransparentRow")).toBeVisible();
    await expect(page.locator("#exportPdfOptions")).toBeHidden();

    // JPEG: no transparency option (raster.js always gives JPEG a white
    // background), background color row still shown.
    await page.check("#exportFormatJpeg");
    await expect(page.locator("#exportTransparentRow")).toBeHidden();
    await expect(page.locator("#exportBackgroundRow")).toBeVisible();
    await expect(page.locator("#exportPdfOptions")).toBeHidden();

    // PDF: its own page size/orientation/selectable-text options appear.
    await page.check("#exportFormatPdf");
    await expect(page.locator("#exportPdfOptions")).toBeVisible();
    await expect(page.locator("#exportTransparentRow")).toBeHidden();
  });

  test("fit-to-content PDF page size hides orientation (it picks its own)", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Control+e");
    await page.check("#exportFormatPdf");

    await expect(page.locator("#exportOrientationRow")).toBeHidden(); // "fit" is the default
    await page.selectOption("#exportPageSize", "a4");
    await expect(page.locator("#exportOrientationRow")).toBeVisible();
  });

  test("selection-only is disabled with nothing selected, and enables once a shape is selected", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Escape"); // make sure nothing is selected
    await page.keyboard.press("Control+e");
    await expect(page.locator("#exportSelectionOnly")).toBeDisabled();

    // Bootstrap only wires the modal's own Escape-to-close handling
    // once its focus trap activates, which it defers until the fade-in
    // transition finishes - so Escape needs focus to have actually
    // landed inside the modal, not just the modal being visible
    // (visible happens immediately on show(), well before that).
    await page.waitForFunction(() =>
      document.activeElement?.closest("#exportModal")
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#exportModal")).toBeHidden();
    await page.evaluate(() => {
      window.eventBus.emit("shapeSelected", window.canvasManager.shapes[0]);
    });
    await page.keyboard.press("Control+e");
    await expect(page.locator("#exportSelectionOnly")).toBeEnabled();
  });

  test("exporting as PNG downloads a file with the expected name", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Control+e");

    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportConfirmBtn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Untitled.png");
  });

  test("exporting as JPEG downloads a .jpg file", async ({ page }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Control+e");
    await page.check("#exportFormatJpeg");

    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportConfirmBtn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Untitled.jpg");
  });

  // The real, meaningful check for docs/TASKS.md P1-8's bundle-size fix
  // (export/pdf.js dynamically imports jsPDF rather than a static
  // top-level import - see that file's own comment): confirms the app
  // still actually produces a real PDF end-to-end against a real
  // browser, proving the dynamic import resolves correctly and doesn't
  // just work by coincidence under Jest's module resolution.
  test("exporting as PDF downloads a .pdf file (exercises jsPDF's dynamic import)", async ({
    page,
  }) => {
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await page.keyboard.press("Control+e");
    await page.check("#exportFormatPdf");

    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportConfirmBtn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Untitled.pdf");

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  });

  test("clicking Export with an empty canvas shows an error instead of downloading", async ({
    page,
  }) => {
    await page.keyboard.press("Control+e");
    await page.click("#exportConfirmBtn");
    await expect(page.locator("#exportError")).toHaveText(/empty/i);
  });
});

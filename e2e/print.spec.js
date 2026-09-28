import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

// jsdom has no real print() implementation (see ui/Print.js's own
// comment), so the actual "does this call window.print()" behavior can
// only be verified here, against a real browser. There is no way to
// intercept a dynamically-created iframe's own contentWindow.print from
// outside the page (each frame is its own JS realm - patching the top
// page's window.print, or Window.prototype, doesn't reach it), so this
// patches Element.prototype.appendChild to stub print() onto the iframe
// the instant the app appends it to the DOM, before app code's own
// synchronous doc.open()/write()/close() and the img's "load" listener
// that actually calls it.
async function interceptIframePrint(page) {
  await page.addInitScript(() => {
    window.__printCalls = 0;
    const origAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function (node) {
      const result = origAppendChild.call(this, node);
      if (node.tagName === "IFRAME" && node.contentWindow) {
        node.contentWindow.print = () => {
          window.__printCalls++;
        };
      }
      return result;
    };
  });
}

test.describe("Print (docs/TASKS.md P1-9)", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
  });

  test("Ctrl+P renders the canvas to an iframe and calls print() on it", async ({
    page,
  }) => {
    await interceptIframePrint(page);
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");

    await page.keyboard.press("Control+p");

    await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);

    const iframeSrc = await page.evaluate(() => {
      const iframe = document.querySelector("iframe");
      return iframe?.contentDocument?.querySelector("img")?.getAttribute("src");
    });
    expect(iframeSrc).toMatch(/^data:image\/png/);
  });

  test("the iframe removes itself after printing (afterprint)", async ({
    page,
  }) => {
    await interceptIframePrint(page);
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");

    await page.keyboard.press("Control+p");
    await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);

    // Firing afterprint ourselves, the way a real print dialog closing
    // would: the intercepted print() stub above only stands in for the
    // native dialog, it doesn't dispatch this event on its own.
    await page.evaluate(() => {
      const iframe = document.querySelector("iframe");
      iframe.contentWindow.dispatchEvent(new Event("afterprint"));
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelectorAll("iframe").length)
      )
      .toBe(0);
  });

  test("Ctrl+P on an empty canvas shows an alert instead of printing", async ({
    page,
  }) => {
    await interceptIframePrint(page);
    await page.goto("/canvas.html");

    let dialogMessage = null;
    page.once("dialog", (d) => {
      dialogMessage = d.message();
      d.accept();
    });

    await page.keyboard.press("Control+p");
    await expect.poll(() => dialogMessage).not.toBeNull();
    expect(dialogMessage).toMatch(/empty/i);
    const printCalls = await page.evaluate(() => window.__printCalls);
    expect(printCalls).toBe(0);
  });
});

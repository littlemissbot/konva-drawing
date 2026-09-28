/**
 * Print (docs/TASKS.md P1-9, Ctrl+P): a PNG of the canvas's content,
 * scaled to fill the page, printed via a hidden iframe rather than
 * window.print() on the main document - printing the page directly
 * would print this app's own UI chrome (toolbars, panels, the
 * top-right save status) around/instead of the drawing, which is never
 * what "print my drawing" means. The iframe gets its own tiny
 * print-only document (just the image, no app styles) so only the
 * drawing itself reaches paper.
 */

import { exportRaster } from "../export/raster.js";

/** The iframe's own document: deliberately independent of this app's
 * own stylesheet (a fresh <head>, not a copy of canvas.html's) so nothing
 * about the app's on-screen layout - dark backgrounds, panel chrome,
 * fixed-position toolbars - can leak into the printed page. `@page`
 * margin: 0 plus a full-bleed image is what "scaled to page" means
 * here: the printed page IS the image, at whatever size the browser's
 * print dialog scales the page to. */
export function buildPrintDocument(dataUrl) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Print</title>
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; }
  img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
<img src="${dataUrl}" alt="" />
</body>
</html>`;
}

/**
 * Renders the stage's content to PNG and sends it to the browser's
 * print flow via a hidden iframe. The iframe removes itself once
 * printing finishes (or after a generous fallback delay - browser
 * support for the `afterprint` event on a printed iframe is not fully
 * consistent, and it staying invisibly in the DOM briefly costs
 * nothing the user can see).
 *
 * @param {import("konva/lib/Stage").Stage} stage
 * @param {object} [options]
 * @param {number} [options.pixelRatio] see export/raster.js.
 * @param {number} [options.padding] see export/raster.js.
 * @returns {{ ok: true } | { ok: false, reason: string, message: string }}
 */
export function printCanvas(stage, options = {}) {
  const { pixelRatio = 2, padding = 20 } = options;

  // Always opaque (white): a printed page has no "transparent" - an
  // unset background would print through as whatever the paper itself
  // is, which is the same visual result as white, but explicit is
  // clearer than relying on that coincidence.
  const result = exportRaster(stage, {
    format: "png",
    pixelRatio,
    padding,
    background: "#ffffff",
  });
  if (!result.ok) return result;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const cleanup = () => iframe.remove();

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(buildPrintDocument(result.dataUrl));
  doc.close();

  const img = doc.querySelector("img");
  img.addEventListener(
    "load",
    () => {
      // Printing before the image has actually loaded produces a blank
      // page - the whole reason this waits for "load" instead of
      // printing immediately after doc.write().
      const win = iframe.contentWindow;
      // jsdom (unit tests) has no real print() implementation; every
      // actual browser does, so this guard changes nothing there - it
      // only keeps the same code path exercisable under Jest instead
      // of needing a separate untested branch. Real print/afterprint
      // behavior is covered by e2e, the same split used throughout
      // export/ and ui/ExportDialog.js.
      if (typeof win.print === "function") {
        win.focus();
        win.print();
      }
    },
    { once: true }
  );
  iframe.contentWindow.addEventListener("afterprint", cleanup, {
    once: true,
  });
  setTimeout(cleanup, 60000);

  return { ok: true };
}

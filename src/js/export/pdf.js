/**
 * PDF export (docs/TASKS.md P1-6): a raster image of the content
 * embedded in a jsPDF document, with an invisible, roughly-positioned
 * text layer placed behind it so the PDF's text is still selectable
 * and searchable - not vector output (Konva has no native SVG/vector
 * export - GitHub issue konvajs/konva#2072, still open), and not
 * pixel-perfect text alignment (PDF's text layout differs from a
 * canvas's, so this is a documented best-effort approximation, matched
 * to what Konva's own official PDF-export recipe does and states as a
 * known limitation, not a gap specific to this implementation).
 */

import { jsPDF } from "jspdf";
import { getContentBoundingBox, exportRaster } from "./raster.js";

// CSS-px page dimensions at 96 DPI - the standard used throughout this
// app's own px-based layout, and what jsPDF's "px" unit is itself based
// on, so a page measured this way lines up with the padding/margin
// numbers used everywhere else in this codebase.
const PAGE_SIZES_PX = {
  a4: [794, 1123],
  letter: [816, 1056],
};

/** Konva's y for a Text node is the top of its box; jsPDF's pdf.text()
 * y is the text baseline. This is an approximation (ascent ≈ font
 * size), not an exact font-metrics calculation - acceptable because the
 * text layer only needs to roughly track the visible, correctly-
 * rendered raster image underneath it, not replace it. */
function approximateBaselineOffset(fontSizePx) {
  return fontSizePx * 0.8;
}

/** Reads every visible Text node's position/size/content in the
 * stage's native (unscaled, unpanned) coordinate space - the same
 * space getContentBoundingBox's returned box is in - so the two can be
 * combined with one shared transform when placing them on the page.
 * Does its own reset-render-restore of the stage transform, same
 * caveat as getContentBoundingBox and for the same reason (this must
 * not depend on the user's current zoom/pan). */
function collectTextLayer(stage) {
  const savedScale = { x: stage.scaleX(), y: stage.scaleY() };
  const savedPosition = { x: stage.x(), y: stage.y() };
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  stage.batchDraw();

  const entries = stage
    .find("Text")
    .filter((node) => node.getStage() && node.isVisible())
    .map((node) => {
      const abs = node.getAbsolutePosition();
      const absScale = node.getAbsoluteScale();
      const fontSizePx = node.fontSize() * absScale.y;
      return {
        text: node.text(),
        x: abs.x,
        y: abs.y + approximateBaselineOffset(fontSizePx),
        fontSizePx,
      };
    });

  stage.scale(savedScale);
  stage.position(savedPosition);
  stage.batchDraw();
  return entries;
}

function addTextLayer(pdf, textEntries, { scale, offsetX, offsetY }) {
  textEntries.forEach(({ text, x, y, fontSizePx }) => {
    if (!text) return;
    // px -> pt, the unit pdf.text()'s fontSize expects regardless of
    // the document's own "px" unit (jsPDF's text sizing is always in
    // pt): 1px = 0.75pt at the standard 96 DPI this app already
    // assumes elsewhere (see PAGE_SIZES_PX above).
    pdf.setFontSize(fontSizePx * scale * 0.75);
    pdf.text(text, offsetX + x * scale, offsetY + y * scale, {
      renderingMode: "invisible",
    });
  });
}

/**
 * @param {import("konva/lib/Stage").Stage} stage
 * @param {object} [options]
 * @param {"fit"|"a4"|"letter"} [options.pageSize] "fit" sizes the page
 *   exactly to the content (plus padding), at native 1:1 scale.
 *   "a4"/"letter" use a fixed page size and scale the content to fit
 *   within it, centered.
 * @param {"portrait"|"landscape"} [options.orientation] ignored for
 *   "fit", which picks whichever the content's own aspect ratio calls
 *   for.
 * @param {number} [options.padding] same meaning as raster.js's export.
 * @param {number} [options.pixelRatio] resolution of the embedded
 *   raster image; see raster.js's MAX_CANVAS_DIMENSION cap.
 * @param {string} [options.background] PDF pages are always opaque;
 *   defaults to white.
 * @param {boolean} [options.selectableText] add the invisible text
 *   layer described above.
 * @returns {{ ok: true, blob: Blob, dataUrl: string } | { ok: false, reason: string, message: string }}
 */
export function exportPdf(stage, options = {}) {
  const {
    pageSize = "fit",
    orientation = "landscape",
    padding = 20,
    pixelRatio = 2,
    background = "#ffffff",
    selectableText = true,
  } = options;

  if (!["fit", "a4", "letter"].includes(pageSize)) {
    return {
      ok: false,
      reason: "invalid-page-size",
      message: `Unsupported PDF page size "${pageSize}": expected "fit", "a4" or "letter".`,
    };
  }

  const box = getContentBoundingBox(stage, { padding });
  if (box.isEmpty) {
    return {
      ok: false,
      reason: "empty",
      message: "Nothing to export: the canvas is empty.",
    };
  }

  const raster = exportRaster(stage, {
    format: "png",
    pixelRatio,
    padding,
    background,
  });
  if (!raster.ok) return raster;

  let pdf, imageX, imageY, imageW, imageH, textTransform;

  if (pageSize === "fit") {
    pdf = new jsPDF({
      orientation: box.width >= box.height ? "landscape" : "portrait",
      unit: "px",
      format: [box.width, box.height],
      hotfixes: ["px_scaling"],
    });
    imageX = 0;
    imageY = 0;
    imageW = box.width;
    imageH = box.height;
    // The raster image (and the content box it was built from) is
    // already offset so that box.x/box.y sit at the page's 0,0; the
    // text layer must be shifted by the same amount to land in the
    // same place under the image.
    textTransform = { scale: 1, offsetX: -box.x, offsetY: -box.y };
  } else {
    let [pageW, pageH] = PAGE_SIZES_PX[pageSize];
    if (orientation === "landscape") [pageW, pageH] = [pageH, pageW];
    pdf = new jsPDF({
      orientation,
      unit: "px",
      format: [pageW, pageH],
      hotfixes: ["px_scaling"],
    });
    const margin = 24;
    const availableW = pageW - margin * 2;
    const availableH = pageH - margin * 2;
    const scale = Math.min(availableW / box.width, availableH / box.height);
    imageW = box.width * scale;
    imageH = box.height * scale;
    imageX = margin + (availableW - imageW) / 2;
    imageY = margin + (availableH - imageH) / 2;
    textTransform = {
      scale,
      offsetX: imageX - box.x * scale,
      offsetY: imageY - box.y * scale,
    };
  }

  pdf.addImage(raster.dataUrl, "PNG", imageX, imageY, imageW, imageH);

  if (selectableText) {
    const textEntries = collectTextLayer(stage);
    addTextLayer(pdf, textEntries, textTransform);
  }

  return {
    ok: true,
    blob: pdf.output("blob"),
    dataUrl: pdf.output("dataurlstring"),
  };
}

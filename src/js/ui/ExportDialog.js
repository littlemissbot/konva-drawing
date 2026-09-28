/**
 * The logic behind the export dialog (docs/TASKS.md P1-8: format, scale,
 * background, selection-only options and a live preview thumbnail).
 * Deliberately split from the actual dialog wiring in main.js (opening/
 * closing the Bootstrap modal, the preview <img>'s debounced refresh):
 * everything here is plain functions over Konva nodes and DOM option
 * elements, so it's unit-testable the same way export/raster.js and
 * export/pdf.js already are, without needing a real modal or browser
 * chrome.
 */

import { exportRaster } from "../export/raster.js";
import { exportPdf } from "../export/pdf.js";

/**
 * Reads the dialog's current option controls into a plain options
 * object, both runExport() and the live preview consume.
 *
 * @param {object} elements
 * @param {Iterable<HTMLInputElement>} elements.formatRadios
 * @param {HTMLSelectElement} elements.scaleSelect
 * @param {HTMLInputElement} elements.transparentCheckbox
 * @param {HTMLInputElement} elements.backgroundColorInput
 * @param {HTMLInputElement} elements.selectionOnlyCheckbox
 * @param {HTMLSelectElement} elements.pageSizeSelect
 * @param {HTMLSelectElement} elements.orientationSelect
 * @param {HTMLInputElement} elements.selectableTextCheckbox
 */
export function gatherExportOptions({
  formatRadios,
  scaleSelect,
  transparentCheckbox,
  backgroundColorInput,
  selectionOnlyCheckbox,
  pageSizeSelect,
  orientationSelect,
  selectableTextCheckbox,
}) {
  const format = [...formatRadios].find((r) => r.checked)?.value || "png";
  // Transparency only makes sense for PNG (raster.js already defaults
  // JPEG's background to white when null is passed, and a PDF page is
  // always opaque) - the checkbox itself is hidden for the other
  // formats, but guard here too so a stale/forced value can't produce
  // a transparent JPEG or PDF.
  const transparent = format === "png" && transparentCheckbox.checked;
  return {
    format,
    pixelRatio: Number(scaleSelect.value) || 2,
    background: transparent ? null : backgroundColorInput.value,
    selectionOnly: selectionOnlyCheckbox.checked,
    pageSize: pageSizeSelect.value,
    orientation: orientationSelect.value,
    selectableText: selectableTextCheckbox.checked,
  };
}

/** Runs `fn()` with every shape except `keepVisible` temporarily
 * hidden, restoring every shape's original visibility afterward
 * regardless of whether `fn` throws/rejects or resolves normally. A
 * no-op (still runs and returns `fn()`) when `keepVisible` is falsy.
 * `fn`'s result is always awaited (harmless for exportRaster's plain
 * synchronous return, necessary for exportPdf's - see runExport below):
 * without that, the `finally` would fire the instant `fn()` returns a
 * *pending* Promise rather than once it actually settles, restoring
 * every shape's visibility while exportPdf is still mid-flight and
 * before it reaches its own visibility-sensitive collectTextLayer()
 * call, defeating selectionOnly for PDF exports specifically. */
async function withOnlyVisible(shapes, keepVisible, fn) {
  if (!keepVisible) return fn();
  const hidden = shapes.filter((s) => s !== keepVisible && s.visible());
  hidden.forEach((s) => s.visible(false));
  try {
    return await fn();
  } finally {
    hidden.forEach((s) => s.visible(true));
  }
}

/**
 * Runs a PNG/JPEG/PDF export against the live stage per the given
 * options, honoring `selectionOnly` by hiding every other shape for the
 * export's duration - Konva's toCanvas()/getClientRect() both already
 * skip invisible nodes, so no other change is needed for either the
 * exported pixels or the content bounding box they're built from to
 * reflect the selection alone, and every shape's visibility is restored
 * before this resolves.
 *
 * "Selection" here is always CanvasManager's single `selectedShape`:
 * Phase 1 has no multi-select yet (docs/TASKS.md P2-1), so there is
 * nothing more to select from.
 *
 * @param {object} args
 * @param {import("konva/lib/Stage").Stage} args.stage
 * @param {import("../canvas/CanvasManager.js").CanvasManager} args.canvasManager
 * @param {ReturnType<typeof gatherExportOptions>} args.options
 * @returns {Promise<ReturnType<typeof exportRaster> | Awaited<ReturnType<typeof exportPdf>>>}
 */
export async function runExport({ stage, canvasManager, options }) {
  const {
    format,
    pixelRatio,
    background,
    selectionOnly,
    pageSize,
    orientation,
    selectableText,
  } = options;

  const keepVisible = selectionOnly ? canvasManager.selectedShape : null;

  return withOnlyVisible(canvasManager.shapes, keepVisible, () => {
    if (format === "pdf") {
      return exportPdf(stage, {
        pageSize,
        orientation,
        pixelRatio,
        background,
        selectableText,
      });
    }
    return exportRaster(stage, { format, pixelRatio, background });
  });
}

const EXTENSIONS = { png: "png", jpeg: "jpg", pdf: "pdf" };

/** Same name-sanitizing as export/json.js's suggestedFilename, with the
 * requested format's own extension instead of always ".json" - kept
 * here rather than generalizing json.js's version, since that module is
 * specifically the JSON format and has no reason to know about the
 * others. */
export function suggestedExportFilename(document, format) {
  const sanitized = (document?.name || "")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const ext = EXTENSIONS[format] || format;
  return `${sanitized || "Untitled"}.${ext}`;
}

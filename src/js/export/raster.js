/**
 * PNG/JPEG export (docs/TASKS.md P1-5).
 *
 * Konva's Stage overrides the generic Node._toKonvaCanvas with one that
 * always defaults to the stage's own fixed width()/height() - the
 * current viewport, not the drawing's content - unless x/y/width/height
 * are passed explicitly (verified against the actual Konva source and a
 * real rendered export, not assumed from the docs: stage.toDataURL()
 * with zoom and pan applied and no options produced a viewport-sized
 * image with the drawn content nowhere near its center, exactly as
 * panning content out of view would). So the content's bounding box is
 * computed at a reset scale/position (any other scale/position would
 * make the box's coordinates depend on the user's current, arbitrary
 * view state, and the point of an export is that it doesn't), the
 * export uses that box explicitly, and the stage's real scale/position
 * is restored immediately after - the user's on-screen view never
 * visibly changes, even though the stage is momentarily reset and
 * restored synchronously.
 */

// A practical, conservative cross-browser safe maximum for a single
// canvas dimension (Safari's documented limit is the usual binding
// constraint; Chrome and Firefox allow more but there is no reliable
// cross-browser number above this to rely on instead).
export const MAX_CANVAS_DIMENSION = 16384;

/**
 * The bounding box of everything drawn on the stage, in the stage's own
 * unscaled/unpanned coordinate space (so it doesn't depend on the
 * user's current zoom/pan), with padding added on every side.
 * `isEmpty` reflects the *unpadded* content (Konva's own getClientRect
 * returns {0,0,0,0} rather than Infinity when there is none) - padding
 * is added regardless, so a caller checking `width <= 0` on the padded
 * box alone would never see an empty canvas as empty once any padding
 * is requested (a padding of 20 turns a genuinely empty {0,0,0,0} box
 * into a blank-but-nonzero {-20,-20,40,40}).
 */
export function getContentBoundingBox(stage, { padding = 0 } = {}) {
  const savedScale = { x: stage.scaleX(), y: stage.scaleY() };
  const savedPosition = { x: stage.x(), y: stage.y() };
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  stage.batchDraw();

  const box = stage.getClientRect();

  stage.scale(savedScale);
  stage.position(savedPosition);
  stage.batchDraw();

  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    isEmpty: box.width <= 0 && box.height <= 0,
  };
}

/** Composites a Konva-rendered canvas (which has no background of its
 * own - transparent where nothing was drawn) onto a plain canvas with
 * an optional solid background underneath, without touching the live
 * Konva scene (no shape is added/removed to fake a background). */
function compositeOntoBackground(sourceCanvas, backgroundColor) {
  const out = document.createElement("canvas");
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext("2d");
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(sourceCanvas, 0, 0);
  return out;
}

/**
 * Exports the stage's content (not its current viewport) as a PNG or
 * JPEG.
 *
 * @param {import("konva/lib/Stage").Stage} stage
 * @param {object} [options]
 * @param {"png"|"jpeg"} [options.format]
 * @param {number} [options.pixelRatio] requested resolution multiplier;
 *   automatically reduced (never increased) if the requested value
 *   would exceed MAX_CANVAS_DIMENSION on either axis, rather than
 *   silently producing a blank/truncated image the way an over-limit
 *   canvas does in most browsers.
 * @param {number} [options.padding] px of padding around the content,
 *   before pixelRatio scaling.
 * @param {string|null} [options.background] a CSS color, or null for
 *   transparent. JPEG has no alpha channel, so null defaults to white
 *   for that format only; PNG keeps true transparency when null.
 * @param {number} [options.quality] 0-1, JPEG only.
 * @returns {{ ok: true, dataUrl: string, width: number, height: number, pixelRatioUsed: number, capped: boolean } | { ok: false, reason: "empty" | "invalid-format", message: string }}
 */
export function exportRaster(stage, options = {}) {
  const {
    format = "png",
    pixelRatio = 2,
    padding = 20,
    background = null,
    quality = 0.92,
  } = options;

  if (format !== "png" && format !== "jpeg") {
    return {
      ok: false,
      reason: "invalid-format",
      message: `Unsupported export format "${format}": expected "png" or "jpeg".`,
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

  let pixelRatioUsed = pixelRatio;
  let capped = false;
  const maxRatio = Math.min(
    MAX_CANVAS_DIMENSION / box.width,
    MAX_CANVAS_DIMENSION / box.height
  );
  if (pixelRatioUsed > maxRatio) {
    // Floor to 2 decimal places rather than the exact boundary, so
    // rounding during canvas creation can't push it back over the cap.
    pixelRatioUsed = Math.max(1, Math.floor(maxRatio * 100) / 100);
    capped = true;
  }

  const rendered = stage.toCanvas({ ...box, pixelRatio: pixelRatioUsed });
  const effectiveBackground =
    background ?? (format === "jpeg" ? "#ffffff" : null);
  const finalCanvas = compositeOntoBackground(rendered, effectiveBackground);

  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = finalCanvas.toDataURL(mimeType, quality);

  return {
    ok: true,
    dataUrl,
    width: finalCanvas.width,
    height: finalCanvas.height,
    pixelRatioUsed,
    capped,
  };
}

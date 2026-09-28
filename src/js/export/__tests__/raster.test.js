import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Rect } from "konva/lib/shapes/Rect";
import {
  getContentBoundingBox,
  exportRaster,
  MAX_CANVAS_DIMENSION,
} from "../raster.js";

function setUpStage({ width = 800, height = 600 } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const stage = new Stage({ container, width, height });
  const layer = new Layer();
  stage.add(layer);
  return {
    stage,
    layer,
    cleanup: () => {
      stage.destroy();
      container.remove();
    },
  };
}

describe("getContentBoundingBox", () => {
  test("is the union of shape bounds plus padding on every side", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 100, y: 100, width: 50, height: 30 }));
    layer.add(new Rect({ x: 200, y: 250, width: 20, height: 20 }));

    const box = getContentBoundingBox(stage, { padding: 10 });

    // Union: x 100..220, y 100..270 (before padding)
    expect(box).toEqual({
      x: 90,
      y: 90,
      width: 140,
      height: 190,
      isEmpty: false,
    });
    cleanup();
  });

  test("does not depend on the stage's current zoom/pan, and restores them afterward", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 100, y: 100, width: 50, height: 30 }));

    const boxAtRest = getContentBoundingBox(stage, { padding: 0 });

    stage.scale({ x: 3, y: 3 });
    stage.position({ x: -500, y: -200 });
    const boxWhileZoomedAndPanned = getContentBoundingBox(stage, {
      padding: 0,
    });

    expect(boxWhileZoomedAndPanned).toEqual(boxAtRest);
    // The zoom/pan the caller had is exactly what they get back.
    expect(stage.scaleX()).toBe(3);
    expect(stage.scaleY()).toBe(3);
    expect(stage.x()).toBe(-500);
    expect(stage.y()).toBe(-200);
    cleanup();
  });

  test("is all zeros for an empty stage, not Infinity/NaN, and isEmpty reflects the content, not the padded box", () => {
    const { stage, cleanup } = setUpStage();
    const box = getContentBoundingBox(stage, { padding: 15 });
    // Padding is still applied around the zero-size box, but isEmpty
    // must stay true regardless: exportRaster relies on isEmpty rather
    // than checking width/height <= 0 on this same padded result,
    // which a nonzero padding (like the 15 here) would always make
    // false even for genuinely empty content - the bug this field
    // exists to prevent.
    expect(box.width).toBe(30);
    expect(box.height).toBe(30);
    expect(box.isEmpty).toBe(true);
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.y)).toBe(true);
    cleanup();
  });
});

describe("exportRaster", () => {
  test("rejects an unsupported format without touching the stage", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 10, height: 10 }));
    const result = exportRaster(stage, { format: "bmp" });
    expect(result).toEqual({
      ok: false,
      reason: "invalid-format",
      message: expect.stringContaining("bmp"),
    });
    cleanup();
  });

  test("reports an empty canvas rather than producing a blank image", () => {
    const { stage, cleanup } = setUpStage();
    const result = exportRaster(stage, { format: "png" });
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });
    cleanup();
  });

  test("exports a PNG with the requested pixelRatio applied to the padded content box", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 100, height: 50 }));

    const result = exportRaster(stage, {
      format: "png",
      pixelRatio: 2,
      padding: 10,
    });

    expect(result.ok).toBe(true);
    expect(result.dataUrl).toBe("data:image/png;base64,00");
    // box: x=-10,y=-10,w=120,h=70 (100+2*10, 50+2*10); *pixelRatio 2
    expect(result.width).toBe(240);
    expect(result.height).toBe(140);
    expect(result.pixelRatioUsed).toBe(2);
    expect(result.capped).toBe(false);
    cleanup();
  });

  test("uses the jpeg mime type", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 10, height: 10 }));
    const result = exportRaster(stage, { format: "jpeg" });
    expect(result.dataUrl).toBe("data:image/jpeg;base64,00");
    cleanup();
  });

  // jest-canvas-mock has no real pixel output to inspect, so the actual
  // rendered color of the background/transparency fill is verified in
  // e2e/export.spec.js against a real browser instead; this only checks
  // that the composite step runs without throwing for both cases.
  test("accepts a background color for PNG (keeps true transparency by default) without throwing", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 10, height: 10 }));
    expect(() =>
      exportRaster(stage, { format: "png", background: "#ff00ff" })
    ).not.toThrow();
    expect(() => exportRaster(stage, { format: "png" })).not.toThrow();
    cleanup();
  });

  test("caps pixelRatio rather than exceeding MAX_CANVAS_DIMENSION, and reports it was capped", () => {
    const { stage, layer, cleanup } = setUpStage();
    // A wide shape whose bounding box alone is already close to the
    // cap, so even a modest pixelRatio would exceed it.
    layer.add(
      new Rect({ x: 0, y: 0, width: MAX_CANVAS_DIMENSION - 100, height: 50 })
    );

    const result = exportRaster(stage, {
      format: "png",
      pixelRatio: 4,
      padding: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.capped).toBe(true);
    expect(result.pixelRatioUsed).toBeLessThan(4);
    expect(result.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    cleanup();
  });
});

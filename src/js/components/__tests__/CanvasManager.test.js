import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Image as KonvaImage } from "konva/lib/shapes/Image";
import { CanvasManager } from "../CanvasManager.js";
import { EventBus } from "../../utils/EventBus.js";

/**
 * These run against real Konva Stage/Layer/shape instances (jest-canvas-mock
 * supplies a mocked 2D context so Konva can construct and draw without a
 * native canvas binding). They cover the save/load round-trip - the same
 * mechanism the app's autosave and docs/TASKS.md P0-3's icon persistence
 * fix depend on - rather than re-deriving expectations from the
 * implementation being tested.
 */
describe("CanvasManager save/load round-trip", () => {
  let container, stage, mainLayer, tooltipLayer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    tooltipLayer = new Layer();
    stage.add(mainLayer);
    stage.add(tooltipLayer);
    canvasManager = new CanvasManager(stage, mainLayer, tooltipLayer);
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  test("Circle round-trips through toStorageShape -> reconstructShapes with the same geometry", () => {
    const circle = new Circle({
      x: 120,
      y: 80,
      radius: 25,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 2,
      name: "Circle 1",
      draggable: true,
    });
    canvasManager.addShape(circle);

    const stored = canvasManager.toStorageShape(circle);
    expect(stored.type).toBe("Circle");
    expect(stored.attrs).toMatchObject({
      x: 120,
      y: 80,
      radius: 25,
      fill: "#ff0000",
      name: "Circle 1",
    });

    canvasManager.clearCanvas();
    expect(canvasManager.shapes).toHaveLength(0);

    canvasManager.reconstructShapes([stored]);
    expect(canvasManager.shapes).toHaveLength(1);
    const rebuilt = canvasManager.shapes[0];
    expect(rebuilt.getClassName()).toBe("Circle");
    expect(rebuilt.x()).toBe(120);
    expect(rebuilt.y()).toBe(80);
    expect(rebuilt.radius()).toBe(25);
    expect(rebuilt.getAttr("name")).toBe("Circle 1");
  });

  test("a full save -> clear -> load cycle preserves every shape (regression test for docs/TASKS.md P0-2's double-load bug)", () => {
    canvasManager.addShape(
      new Circle({ x: 10, y: 10, radius: 5, name: "Circle 1" })
    );
    canvasManager.addShape(
      new Rect({ x: 20, y: 20, width: 30, height: 30, name: "Rect 1" })
    );
    expect(canvasManager.shapes).toHaveLength(2);

    const json = JSON.stringify({
      shapes: canvasManager.shapes.map((s) => canvasManager.toStorageShape(s)),
    });

    canvasManager.clearCanvas();
    const parsed = JSON.parse(json);
    canvasManager.reconstructShapes(parsed.shapes);

    // Exactly 2, not 4: reconstructShapes must not be called more than
    // once for the same saved data (see docs/TASKS.md P0-2).
    expect(canvasManager.shapes).toHaveLength(2);
    expect(canvasManager.shapes.map((s) => s.getClassName()).sort()).toEqual([
      "Circle",
      "Rect",
    ]);
  });

  describe("Image (SVG icon) persistence — docs/TASKS.md P0-3", () => {
    test("toStorageShape stores a relative iconFile, never the DOM image element or an absolute URL", () => {
      const img = new KonvaImage({
        x: 5,
        y: 5,
        width: 50,
        height: 50,
        name: "SVG 1",
        iconFile: "007-excavator.svg",
        image: new window.Image(), // the live HTMLImageElement Konva stores
      });
      canvasManager.addShape(img);

      const stored = canvasManager.toStorageShape(img);
      expect(stored.type).toBe("Image");
      expect(stored.attrs.iconFile).toBe("007-excavator.svg");
      expect(stored.attrs).not.toHaveProperty("image");
      expect(stored.attrs).not.toHaveProperty("svgUrl");

      // The whole point of storing iconFile instead of image().src: this
      // must be safe to JSON.stringify and must never contain a baked-in
      // absolute URL that would break on a different origin.
      const json = JSON.stringify(stored);
      expect(json).not.toMatch(/https?:\/\//);
      expect(json).not.toContain("HTMLImageElement");
    });

    // Legacy-svgUrl fallback (no iconFile) is covered by the spy-based
    // test below: reconstructShapes' fetch is async and the real
    // assertion is which URL it requests, not whether the shape lands
    // on canvasManager.shapes (jsdom has no real network, so that fetch
    // never resolves either way in a unit test).
  });
});

describe("CanvasManager Image URL resolution (spy-based, no real network needed)", () => {
  test("reconstructShapes requests assets/svgs/<basename> for a legacy svgUrl, and assets/svgs/<iconFile> for the current format", () => {
    window.eventBus = new EventBus();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const stage = new Stage({ container, width: 400, height: 300 });
    const mainLayer = new Layer();
    stage.add(mainLayer);
    const canvasManager = new CanvasManager(stage, mainLayer, new Layer());

    const requestedUrls = [];
    const originalFromURL = KonvaImage.fromURL;
    KonvaImage.fromURL = (url) => {
      requestedUrls.push(url);
      // Never invoke the success/error callbacks: this test only cares
      // about which URL was requested, not about completing the load.
    };

    canvasManager.reconstructShapes([
      { type: "Image", attrs: { x: 0, y: 0, width: 10, height: 10, iconFile: "003-conveyor.svg" } },
      {
        type: "Image",
        attrs: {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          svgUrl: "https://old-domain.example.com/assets/svgs/010-building-crane.svg",
        },
      },
    ]);

    expect(requestedUrls).toEqual([
      "assets/svgs/003-conveyor.svg",
      "assets/svgs/010-building-crane.svg",
    ]);

    KonvaImage.fromURL = originalFromURL;
    stage.destroy();
    container.remove();
  });
});

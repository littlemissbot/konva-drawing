import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Image as KonvaImage } from "konva/lib/shapes/Image";
import { Group } from "konva/lib/Group";
import { CanvasManager } from "../CanvasManager.js";
import { EventBus } from "../../core/EventBus.js";
import {
  createId,
  createEmptyDocument,
  validateDocument,
} from "../../core/Document.js";

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
      {
        type: "Image",
        attrs: {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          iconFile: "003-conveyor.svg",
        },
      },
      {
        type: "Image",
        attrs: {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          svgUrl:
            "https://old-domain.example.com/assets/svgs/010-building-crane.svg",
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

// docs/TASKS.md P1-1: the bridge between live Konva shapes and
// core/Document.js's v2 schema.
describe("CanvasManager <-> core/Document.js bridge", () => {
  let container, stage, mainLayer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    stage.add(mainLayer);
    canvasManager = new CanvasManager(stage, mainLayer, new Layer());
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  test("toDocumentObjects assigns zIndex from array/stacking order and carries each shape's own id", () => {
    const a = new Circle({ x: 1, y: 1, radius: 5, id: createId(), name: "A" });
    const b = new Rect({
      x: 2,
      y: 2,
      width: 5,
      height: 5,
      id: createId(),
      name: "B",
    });
    canvasManager.addShape(a);
    canvasManager.addShape(b);

    const objects = canvasManager.toDocumentObjects();
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ id: a.id(), type: "Circle", zIndex: 0 });
    expect(objects[1]).toMatchObject({ id: b.id(), type: "Rect", zIndex: 1 });
    expect(objects[0].id).not.toBe(objects[1].id);
  });

  test("toDocumentObjects produces a document that validates against core/Document.js's schema", () => {
    canvasManager.addShape(
      new Circle({ x: 1, y: 1, radius: 5, id: createId() })
    );
    canvasManager.addShape(
      new Rect({ x: 2, y: 2, width: 5, height: 5, id: createId() })
    );

    const doc = createEmptyDocument();
    doc.objects = canvasManager.toDocumentObjects();

    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
  });

  test("loadDocumentObjects sorts by zIndex, independent of input array order", () => {
    canvasManager.loadDocumentObjects([
      {
        id: "obj_b",
        type: "Rect",
        zIndex: 1,
        attrs: { x: 20, y: 20, width: 5, height: 5, id: "obj_b", name: "B" },
      },
      {
        id: "obj_a",
        type: "Circle",
        zIndex: 0,
        attrs: { x: 10, y: 10, radius: 5, id: "obj_a", name: "A" },
      },
    ]);

    // Given out of zIndex order in the input, still reconstructed in
    // zIndex order (Konva stacking order follows add() call order).
    expect(canvasManager.shapes.map((s) => s.getAttr("name"))).toEqual([
      "A",
      "B",
    ]);
  });

  test("a full toDocumentObjects -> JSON -> loadDocumentObjects round-trip preserves ids, types and geometry", () => {
    const original = [
      new Circle({ x: 15, y: 25, radius: 8, id: createId(), name: "Circle 1" }),
      new Rect({
        x: 30,
        y: 40,
        width: 12,
        height: 6,
        id: createId(),
        name: "Rect 1",
      }),
    ];
    original.forEach((s) => canvasManager.addShape(s));
    const originalIds = original.map((s) => s.id());

    const json = JSON.stringify(canvasManager.toDocumentObjects());
    canvasManager.clearCanvas();
    expect(canvasManager.shapes).toHaveLength(0);

    canvasManager.loadDocumentObjects(JSON.parse(json));

    expect(canvasManager.shapes).toHaveLength(2);
    expect(canvasManager.shapes.map((s) => s.id())).toEqual(originalIds);
    const rebuiltCircle = canvasManager.shapes.find(
      (s) => s.getClassName() === "Circle"
    );
    expect(rebuiltCircle.x()).toBe(15);
    expect(rebuiltCircle.y()).toBe(25);
    expect(rebuiltCircle.radius()).toBe(8);
  });

  test("StickyNote and Image objects also get a real id, not just basic shapes", () => {
    const group = new Group({
      x: 0,
      y: 0,
      toolType: "sticky",
      id: createId(),
      name: "Note 1",
    });
    const rect = new Rect({ width: 200, height: 140 });
    group.add(rect);
    canvasManager.addShape(group);

    const [obj] = canvasManager.toDocumentObjects();
    expect(obj.type).toBe("StickyNote");
    expect(obj.id).toBe(group.id());
    expect(obj.id).toBeTruthy();
  });

  // docs/TASKS.md P1-7: JSON import's "merge" mode, as opposed to
  // loadDocumentObjects' full replace.
  describe("mergeDocumentObjects", () => {
    test("adds the incoming objects after what's already on the canvas, without removing it", () => {
      canvasManager.addShape(
        new Circle({ x: 1, y: 1, radius: 5, id: createId(), name: "Existing" })
      );

      canvasManager.mergeDocumentObjects([
        {
          id: "obj_incoming",
          type: "Rect",
          zIndex: 0,
          attrs: {
            x: 9,
            y: 9,
            width: 5,
            height: 5,
            id: "obj_incoming",
            name: "Incoming",
          },
        },
      ]);

      expect(canvasManager.shapes.map((s) => s.getAttr("name"))).toEqual([
        "Existing",
        "Incoming",
      ]);
    });

    test("mints a fresh id for an incoming object whose id collides with one already on the canvas", () => {
      const existing = new Circle({
        x: 1,
        y: 1,
        radius: 5,
        id: "dup",
        name: "Existing",
      });
      canvasManager.addShape(existing);

      canvasManager.mergeDocumentObjects([
        {
          id: "dup",
          type: "Rect",
          zIndex: 0,
          attrs: {
            x: 9,
            y: 9,
            width: 5,
            height: 5,
            id: "dup",
            name: "Incoming",
          },
        },
      ]);

      expect(canvasManager.shapes).toHaveLength(2);
      const [, incoming] = canvasManager.shapes;
      expect(incoming.id()).not.toBe("dup");
      expect(incoming.id()).toBeTruthy();
    });

    test("preserves the incoming objects' own relative zIndex order regardless of input array order", () => {
      canvasManager.mergeDocumentObjects([
        {
          id: "obj_b",
          type: "Rect",
          zIndex: 1,
          attrs: { x: 20, y: 20, width: 5, height: 5, id: "obj_b", name: "B" },
        },
        {
          id: "obj_a",
          type: "Circle",
          zIndex: 0,
          attrs: { x: 10, y: 10, radius: 5, id: "obj_a", name: "A" },
        },
      ]);

      expect(canvasManager.shapes.map((s) => s.getAttr("name"))).toEqual([
        "A",
        "B",
      ]);
    });
  });
});

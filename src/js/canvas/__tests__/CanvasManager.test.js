import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Image as KonvaImage } from "konva/lib/shapes/Image";
import { Group } from "konva/lib/Group";
import { Transformer } from "konva/lib/shapes/Transformer";
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

    // docs/TASKS.md P2-4: a pasted image has no bundled asset file at
    // all, so it round-trips through an embedded imageSrc data URL
    // instead of iconFile - the two are mutually exclusive.
    test("toStorageShape stores imageSrc, not iconFile, for an image with no iconFile", () => {
      const img = new KonvaImage({
        x: 5,
        y: 5,
        width: 50,
        height: 50,
        name: "Image 1",
        imageSrc: "data:image/png;base64,AAAA",
        image: new window.Image(),
      });
      canvasManager.addShape(img);

      const stored = canvasManager.toStorageShape(img);
      expect(stored.type).toBe("Image");
      expect(stored.attrs.imageSrc).toBe("data:image/png;base64,AAAA");
      expect(stored.attrs).not.toHaveProperty("iconFile");
      expect(stored.attrs).not.toHaveProperty("image");
    });
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

  // docs/TASKS.md P2-4: reconstructShapes' onSettled is how paste/
  // duplicate know every shape - including an Image's async load - has
  // actually landed before selecting the batch and committing history.
  describe("reconstructShapes onSettled", () => {
    function setup() {
      window.eventBus = new EventBus();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const stage = new Stage({ container, width: 400, height: 300 });
      const mainLayer = new Layer();
      stage.add(mainLayer);
      return {
        canvasManager: new CanvasManager(stage, mainLayer, new Layer()),
        teardown: () => {
          stage.destroy();
          container.remove();
        },
      };
    }

    test("fires once per input, synchronously and in order, for non-Image types", () => {
      const { canvasManager, teardown } = setup();
      const settled = [];

      canvasManager.reconstructShapes(
        [
          { type: "Circle", attrs: { x: 0, y: 0, radius: 5 } },
          { type: "Rect", attrs: { x: 0, y: 0, width: 5, height: 5 } },
        ],
        { onSettled: (shape) => settled.push(shape) }
      );

      // Synchronous: already settled by the time reconstructShapes returns.
      expect(settled).toHaveLength(2);
      expect(settled[0].getClassName()).toBe("Circle");
      expect(settled[1].getClassName()).toBe("Rect");
      teardown();
    });

    test("fires with null for an object of an unknown type or an Image with neither iconFile nor imageSrc", () => {
      const { canvasManager, teardown } = setup();
      const settled = [];

      canvasManager.reconstructShapes(
        [
          { type: "NotAShape", attrs: {} },
          { type: "Image", attrs: { x: 0, y: 0 } },
        ],
        { onSettled: (shape) => settled.push(shape) }
      );

      expect(settled).toEqual([null, null]);
      teardown();
    });

    test("fires after the async load for an Image (iconFile or imageSrc), on both success and failure", () => {
      const { canvasManager, teardown } = setup();
      const originalFromURL = KonvaImage.fromURL;
      const callbacks = [];
      KonvaImage.fromURL = (url, onSuccess, onError) => {
        callbacks.push({ onSuccess, onError });
      };

      const settled = [];
      canvasManager.reconstructShapes(
        [
          {
            type: "Image",
            attrs: { x: 0, y: 0, width: 5, height: 5, iconFile: "a.svg" },
          },
          {
            type: "Image",
            attrs: {
              x: 0,
              y: 0,
              width: 5,
              height: 5,
              imageSrc: "data:image/png;base64,AAAA",
            },
          },
        ],
        { onSettled: (shape) => settled.push(shape) }
      );

      // Not yet settled: both loads are still pending.
      expect(settled).toHaveLength(0);
      expect(callbacks).toHaveLength(2);

      callbacks[0].onSuccess(new KonvaImage({}));
      expect(settled).toHaveLength(1);
      expect(settled[0]).not.toBeNull();

      callbacks[1].onError();
      expect(settled).toHaveLength(2);
      expect(settled[1]).toBeNull();

      KonvaImage.fromURL = originalFromURL;
      teardown();
    });
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

// docs/TASKS.md P2-1: multi-select.
describe("CanvasManager multi-select", () => {
  let container, stage, mainLayer, transformer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    stage.add(mainLayer);
    transformer = new Transformer();
    mainLayer.add(transformer);
    canvasManager = new CanvasManager(
      stage,
      mainLayer,
      new Layer(),
      transformer
    );
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  function click(shape, { shiftKey = false } = {}) {
    shape.fire("click", { evt: { shiftKey } }, true);
  }

  test("selectShape replaces the whole selection with just one shape", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 20, y: 20, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);

    canvasManager.selectShape(a);
    canvasManager.selectShape(b);

    expect(canvasManager.selectedShapes).toEqual([b]);
    expect(canvasManager.selectedShape).toBe(b);
  });

  test("shift-clicking an unselected shape adds it without deselecting the rest", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 20, y: 20, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.setupShapeEvents(a, "A");
    canvasManager.setupShapeEvents(b, "B");

    click(a);
    click(b, { shiftKey: true });

    expect(canvasManager.selectedShapes.sort()).toEqual([a, b].sort());
  });

  test("shift-clicking an already-selected shape removes just that one", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 20, y: 20, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.setupShapeEvents(a, "A");
    canvasManager.setupShapeEvents(b, "B");
    canvasManager.selectAll();

    click(a, { shiftKey: true });

    expect(canvasManager.selectedShapes).toEqual([b]);
  });

  test("a plain click (no Shift) on one of several selected shapes collapses the selection to just that shape", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 20, y: 20, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.setupShapeEvents(a, "A");
    canvasManager.setupShapeEvents(b, "B");
    canvasManager.selectAll();

    click(a);

    expect(canvasManager.selectedShapes).toEqual([a]);
  });

  test("selectAll selects every shape on the canvas", () => {
    [1, 2, 3].forEach((i) =>
      canvasManager.addShape(new Circle({ x: i, y: i, radius: 5 }))
    );
    canvasManager.selectAll();
    expect(canvasManager.selectedShapes).toHaveLength(3);
  });

  test("deselectShape clears the whole selection, not just the primary", () => {
    canvasManager.addShape(new Circle({ x: 0, y: 0, radius: 5 }));
    canvasManager.addShape(new Circle({ x: 20, y: 20, radius: 5 }));
    canvasManager.selectAll();

    canvasManager.deselectShape();

    expect(canvasManager.selectedShapes).toEqual([]);
    expect(canvasManager.selectedShape).toBeNull();
  });

  test("the transformer wraps every selected shape", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 20, y: 20, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);

    canvasManager.selectAll();

    expect(transformer.nodes().sort()).toEqual([a, b].sort());
  });

  test("removeShapes deletes every given shape and emits shapeRemoved once", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 20, y: 20, radius: 5 });
    const c = new Circle({ x: 40, y: 40, radius: 5 });
    [a, b, c].forEach((s) => canvasManager.addShape(s));
    canvasManager.selection.set([a, b]);

    let removedEvents = 0;
    window.eventBus.on("shapeRemoved", () => {
      removedEvents += 1;
    });

    canvasManager.removeShapes([a, b]);

    expect(canvasManager.shapes).toEqual([c]);
    expect(removedEvents).toBe(1);
    // Removed shapes drop out of the selection too, not left dangling.
    expect(canvasManager.selectedShapes).toEqual([]);
  });

  // Dragging one shape in a multi-selection moving the rest of the
  // selection together is NOT implemented in CanvasManager itself - an
  // earlier version of this file hand-rolled that (tracking each
  // selected shape's drag-start position and reapplying the delta) and
  // had its own pair of unit tests for it, using synthetic
  // shape.fire("dragstart"/"dragmove") calls. That custom logic turned
  // out to duplicate a feature Konva's own Transformer already
  // implements internally (_proxyDrag, wired automatically the moment
  // transformer.nodes([...]) includes more than one node - which
  // _syncTransformer above already does on every selection change) and
  // fought with it, compounding into visibly wrong movement under a
  // real mouse drag - a bug a synthetic-event unit test could not have
  // caught (Konva's real drag-and-drop registration, which
  // Transformer's own proxying depends on, needs actual pointer
  // events, not directly fired "dragmove"). It's now covered for real
  // in e2e/selection.spec.js's "dragging one selected shape moves the
  // rest of the selection together", against an actual browser mouse
  // drag; "the transformer wraps every selected shape" above is what
  // makes that behavior possible in the first place.

  test("clearCanvas clears the selection along with the shapes", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    canvasManager.clearCanvas();

    expect(canvasManager.selectedShapes).toEqual([]);
    expect(transformer.nodes()).toEqual([]);
  });
});

// docs/TASKS.md P2-4: copy/cut/paste/duplicate.
describe("CanvasManager clipboard", () => {
  let container, stage, mainLayer, transformer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    stage.add(mainLayer);
    transformer = new Transformer();
    mainLayer.add(transformer);
    canvasManager = new CanvasManager(
      stage,
      mainLayer,
      new Layer(),
      transformer
    );
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  test("copySelection is a no-op with nothing selected", () => {
    canvasManager.copySelection();
    expect(canvasManager.clipboard.hasContent).toBe(false);
  });

  test("copySelection stores the selection, pasteClipboard adds an offset copy and selects it", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5, name: "A" });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    canvasManager.copySelection();
    expect(canvasManager.clipboard.hasContent).toBe(true);
    expect(canvasManager.shapes).toHaveLength(1); // copy alone adds nothing

    canvasManager.pasteClipboard();

    expect(canvasManager.shapes).toHaveLength(2);
    const pasted = canvasManager.shapes.find((s) => s !== a);
    expect(pasted.getClassName()).toBe("Circle");
    expect(pasted.x()).toBe(30); // 10 + the default 20px offset
    expect(pasted.y()).toBe(30);
    expect(pasted.id()).not.toBe(a.id());
    expect(pasted.getAttr("name")).toBe("A"); // name preserved, unlike id
    // The newly-pasted shape becomes the selection, not the original.
    expect(canvasManager.selectedShapes).toEqual([pasted]);
  });

  test("pasteClipboard is a no-op with nothing copied yet", () => {
    canvasManager.pasteClipboard();
    expect(canvasManager.shapes).toHaveLength(0);
  });

  test("pasting twice offsets each paste from the last copy, not cumulatively from the previous paste", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.copySelection();

    canvasManager.pasteClipboard();
    canvasManager.pasteClipboard();

    const pastedXs = canvasManager.shapes
      .filter((s) => s !== a)
      .map((s) => s.x());
    expect(pastedXs).toEqual([20, 20]);
  });

  test("pasting a multi-shape selection adds and selects every shape, in one shapeAdded emission", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 100, y: 100, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.copySelection();

    let addedEvents = 0;
    window.eventBus.on("shapeAdded", () => {
      addedEvents += 1;
    });

    canvasManager.pasteClipboard();

    expect(canvasManager.shapes).toHaveLength(4);
    expect(addedEvents).toBe(1);
    expect(canvasManager.selectedShapes).toHaveLength(2);
  });

  test("cutSelection copies then removes the selection, in one removeShapes call", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    let removedEvents = 0;
    window.eventBus.on("shapeRemoved", () => {
      removedEvents += 1;
    });

    canvasManager.cutSelection();

    expect(canvasManager.shapes).toEqual([]);
    expect(removedEvents).toBe(1);
    expect(canvasManager.clipboard.hasContent).toBe(true);

    canvasManager.pasteClipboard();
    expect(canvasManager.shapes).toHaveLength(1);
    expect(canvasManager.shapes[0].x()).toBe(20); // 0 + the default offset
  });

  test("cutSelection is a no-op with nothing selected", () => {
    canvasManager.cutSelection();
    expect(canvasManager.clipboard.hasContent).toBe(false);
  });

  test("duplicateSelection adds an offset copy without touching the clipboard", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5 });
    const copied = new Circle({ x: 999, y: 999, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(copied);
    canvasManager.selectShape(copied);
    canvasManager.copySelection(); // an earlier real copy, unrelated to what's duplicated below
    canvasManager.selectShape(a);

    canvasManager.duplicateSelection();

    expect(canvasManager.shapes).toHaveLength(3);
    const duplicate = canvasManager.shapes.find((s) => s !== a && s !== copied);
    expect(duplicate.x()).toBe(30);
    expect(duplicate.id()).not.toBe(a.id());
    expect(canvasManager.selectedShapes).toEqual([duplicate]);

    // Duplicate must not have clobbered the earlier real copy.
    canvasManager.pasteClipboard();
    const pastedFromClipboard = canvasManager.shapes.find(
      (s) => s.x() === 1019 // 999 + 20
    );
    expect(pastedFromClipboard).toBeTruthy();
  });

  test("duplicateSelection is a no-op with nothing selected", () => {
    canvasManager.duplicateSelection();
    expect(canvasManager.shapes).toHaveLength(0);
  });

  // docs/PRD.md Phase 2's own stated AC: "copy-paste of a group
  // preserves structure." P2-4 (this describe block) and P2-6 (group)
  // were each tested against plain shapes on their own, never together
  // - this verifies the two actually compose, not just that each works
  // in isolation.
  test("copy-paste of a real group preserves its structure (children, types, names)", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5, name: "A" });
    const b = new Circle({ x: 50, y: 50, radius: 5, name: "B" });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.selectedShape;
    canvasManager.copySelection();

    canvasManager.pasteClipboard();

    expect(canvasManager.shapes).toHaveLength(2); // original group + pasted one
    const pasted = canvasManager.selectedShape;
    expect(pasted).not.toBe(group);
    expect(pasted.getClassName()).toBe("Group");
    expect(pasted.getAttr("toolType")).toBe("group");
    const children = pasted.getChildren();
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.getClassName())).toEqual(["Circle", "Circle"]);
    expect(children.map((c) => c.getAttr("name")).sort()).toEqual(["A", "B"]);
    // The pasted group's own id, and each child's, are fresh - not
    // shared with the original group or its children.
    expect(pasted.id()).not.toBe(group.id());
    const originalChildIds = [a.id(), b.id()];
    children.forEach((c) => expect(originalChildIds).not.toContain(c.id()));
  });
});

// docs/TASKS.md P2-5: arrow-key nudge.
describe("CanvasManager.nudgeSelection", () => {
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

  test("moves every selected shape by the same delta", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5 });
    const b = new Circle({ x: 50, y: 50, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.nudgeSelection(1, 0);

    expect(a.x()).toBe(11);
    expect(a.y()).toBe(10);
    expect(b.x()).toBe(51);
    expect(b.y()).toBe(50);
  });

  test("an unselected shape is left untouched", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5 });
    const untouched = new Circle({ x: 20, y: 20, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(untouched);
    canvasManager.selectShape(a);

    canvasManager.nudgeSelection(0, 10);

    expect(untouched.x()).toBe(20);
    expect(untouched.y()).toBe(20);
  });

  test("emits shapeNudged once per call, not once per shape", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    let events = 0;
    window.eventBus.on("shapeNudged", () => {
      events += 1;
    });

    canvasManager.nudgeSelection(1, 1);

    expect(events).toBe(1);
  });

  test("is a no-op with nothing selected - no shapeNudged emission", () => {
    canvasManager.addShape(new Circle({ x: 10, y: 10, radius: 5 }));

    let events = 0;
    window.eventBus.on("shapeNudged", () => {
      events += 1;
    });

    canvasManager.nudgeSelection(5, 5);

    expect(events).toBe(0);
    expect(canvasManager.shapes[0].x()).toBe(10);
  });
});

// docs/TASKS.md P2-6: group/ungroup, double-click to enter a group.
describe("CanvasManager group/ungroup", () => {
  let container, stage, mainLayer, transformer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    stage.add(mainLayer);
    transformer = new Transformer();
    mainLayer.add(transformer);
    canvasManager = new CanvasManager(
      stage,
      mainLayer,
      new Layer(),
      transformer
    );
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  function click(shape, { shiftKey = false } = {}) {
    shape.fire("click", { evt: { shiftKey } }, true);
  }
  function dblclick(shape) {
    shape.fire("dblclick", { evt: {} }, true);
  }

  test("groupSelection is a no-op with fewer than 2 shapes selected", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    canvasManager.groupSelection();

    expect(canvasManager.shapes).toEqual([a]);
  });

  test("groupSelection is a no-op if any selected shape isn't a groupable type", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const sticky = new Group({ toolType: "sticky", id: createId() });
    canvasManager.addShape(a);
    canvasManager.addShape(sticky);
    canvasManager.selection.set([a, sticky]);

    canvasManager.groupSelection();

    expect(canvasManager.shapes).toEqual([a, sticky]);
  });

  test("groups the selection into one Group, removing the originals from the top level and selecting the group", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5, name: "A" });
    const b = new Circle({ x: 50, y: 50, radius: 5, name: "B" });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.groupSelection();

    expect(canvasManager.shapes).toHaveLength(1);
    const group = canvasManager.shapes[0];
    expect(group.getClassName()).toBe("Group");
    expect(group.getAttr("toolType")).toBe("group");
    expect(
      group
        .getChildren()
        .map((c) => c.getAttr("name"))
        .sort()
    ).toEqual(["A", "B"]);
    expect(canvasManager.selectedShapes).toEqual([group]);
    // Group sits at the origin with the children's own x/y unchanged -
    // grouping must not visibly move anything.
    expect(group.x()).toBe(0);
    expect(group.y()).toBe(0);
    expect(a.x()).toBe(10);
    expect(b.x()).toBe(50);
  });

  test("inserts the new group at the lowest original zIndex of the grouped shapes, not at the end", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    const c = new Circle({ x: 20, y: 20, radius: 5 });
    [a, b, c].forEach((s) => canvasManager.addShape(s));
    canvasManager.selection.set([c, a]); // selected out of zIndex order

    canvasManager.groupSelection();

    // a and c grouped; b (originally in the middle) stays top-level and
    // the group takes a's old position (index 0), not the end.
    expect(canvasManager.shapes).toHaveLength(2);
    expect(canvasManager.shapes[0].getClassName()).toBe("Group");
    expect(canvasManager.shapes[1]).toBe(b);
  });

  test("emits shapeAdded once", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    let events = 0;
    window.eventBus.on("shapeAdded", () => {
      events += 1;
    });
    canvasManager.groupSelection();
    expect(events).toBe(1);
  });

  test("clicking a child of a not-entered group selects the whole group", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];
    canvasManager.deselectShape();

    click(a);

    expect(canvasManager.selectedShapes).toEqual([group]);
  });

  test("double-clicking a group enters it, so a later click on a child selects just that child", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];

    dblclick(group);
    click(a);

    expect(canvasManager.selectedShapes).toEqual([a]);
  });

  test("selecting something outside the entered group exits it - clicking the same child again re-selects the group", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    const outsider = new Circle({ x: 100, y: 100, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.addShape(outsider);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes.find((s) => s !== outsider);

    dblclick(group);
    click(a);
    expect(canvasManager.selectedShapes).toEqual([a]);

    canvasManager.selectShape(outsider); // selecting elsewhere exits the group
    click(a);
    expect(canvasManager.selectedShapes).toEqual([group]);
  });

  test("Escape (deselectShape) exits an entered group", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];
    dblclick(group);

    canvasManager.deselectShape();
    click(a);

    expect(canvasManager.selectedShapes).toEqual([group]);
  });

  test("shift-clicking a child while entered toggles just that child; while not entered, toggles the group", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];
    canvasManager.deselectShape();

    click(a, { shiftKey: true });
    expect(canvasManager.selectedShapes).toEqual([group]);

    canvasManager.deselectShape();
    dblclick(group);
    click(a, { shiftKey: true });
    expect(canvasManager.selectedShapes).toEqual([a]);
  });

  test("Delete removes a selected child inside an entered group", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];
    dblclick(group);
    click(a);
    expect(canvasManager.selectedShapes).toEqual([a]);

    canvasManager.removeShapes([a]);

    expect(group.getChildren()).toHaveLength(1);
    expect(group.getChildren()[0]).toBe(b);
    expect(canvasManager.shapes).toEqual([group]); // group itself untouched
  });

  test("ungroupSelection is a no-op unless exactly one real group is selected", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.ungroupSelection(); // a plain shape, not a group

    expect(canvasManager.shapes).toEqual([a]);

    const sticky = new Group({ toolType: "sticky", id: createId() });
    canvasManager.addShape(sticky);
    canvasManager.selectShape(sticky);
    canvasManager.ungroupSelection(); // a sticky note, not this feature's group

    expect(canvasManager.shapes).toEqual([a, sticky]);
  });

  test("ungroups back into independent top-level shapes at the group's own zIndex, selecting them, in one shapeRemoved emission", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5, name: "A" });
    const b = new Circle({ x: 50, y: 50, radius: 5, name: "B" });
    const other = new Circle({ x: 200, y: 200, radius: 5, name: "Other" });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    canvasManager.addShape(other);
    const group = canvasManager.shapes.find((s) => s !== other);
    canvasManager.selectShape(group);

    let removedEvents = 0;
    window.eventBus.on("shapeRemoved", () => {
      removedEvents += 1;
    });

    canvasManager.ungroupSelection();

    expect(removedEvents).toBe(1);
    expect(canvasManager.shapes).toHaveLength(3);
    // Ungrouped shapes land back at the group's own zIndex (index 0),
    // not appended after `other`.
    expect(canvasManager.shapes.map((s) => s.getAttr("name")).sort()).toEqual(
      ["A", "B", "Other"].sort()
    );
    expect(canvasManager.shapes[2]).toBe(other);
    const restored = canvasManager.shapes.filter((s) => s !== other);
    expect(canvasManager.selectedShapes.sort()).toEqual(restored.sort());
    restored.forEach((s) => expect(s.draggable()).toBe(true));
  });

  test("ungrouping bakes the group's own position into each child, so nothing visibly moves", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(new Circle({ x: 50, y: 50, radius: 5 }));
    canvasManager.selection.set([a, canvasManager.shapes[1]]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];
    group.position({ x: 30, y: 40 }); // the group itself was dragged

    canvasManager.selectShape(group);
    canvasManager.ungroupSelection();

    const restoredA = canvasManager.shapes.find((s) => s.x() === 40); // 10 + 30
    expect(restoredA).toBeTruthy();
    expect(restoredA.y()).toBe(50); // 10 + 40
  });

  test("a Group with children round-trips through toStorageShape -> reconstructShapes", () => {
    const a = new Circle({ x: 10, y: 10, radius: 5, name: "A" });
    const b = new Circle({ x: 50, y: 50, radius: 5, name: "B" });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.shapes[0];

    const stored = canvasManager.toStorageShape(group);
    expect(stored.type).toBe("Group");
    expect(stored.attrs.children).toHaveLength(2);
    expect(stored.attrs.children.map((c) => c.type)).toEqual([
      "Circle",
      "Circle",
    ]);

    canvasManager.clearCanvas();
    canvasManager.reconstructShapes([stored]);

    expect(canvasManager.shapes).toHaveLength(1);
    const rebuilt = canvasManager.shapes[0];
    expect(rebuilt.getClassName()).toBe("Group");
    expect(rebuilt.getAttr("toolType")).toBe("group");
    const children = rebuilt.getChildren();
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.getAttr("name")).sort()).toEqual(["A", "B"]);
    children.forEach((c) => expect(c.draggable()).toBe(false));

    // Reconstructed children get the group-aware click wiring too, not
    // the generic top-level one - clicking one selects the group.
    click(children[0]);
    expect(canvasManager.selectedShapes).toEqual([rebuilt]);
  });
});

// docs/TASKS.md P2-7: lock/unlock.
describe("CanvasManager.toggleLockSelection", () => {
  let container, stage, mainLayer, transformer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    stage.add(mainLayer);
    transformer = new Transformer();
    mainLayer.add(transformer);
    canvasManager = new CanvasManager(
      stage,
      mainLayer,
      new Layer(),
      transformer
    );
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  test("is a no-op with nothing selected", () => {
    let events = 0;
    window.eventBus.on("shapeLockChanged", () => {
      events += 1;
    });
    canvasManager.toggleLockSelection();
    expect(events).toBe(0);
  });

  test("locks every selected shape and makes it non-draggable, excluded from the transformer", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5, draggable: true });
    const b = new Circle({ x: 10, y: 10, radius: 5, draggable: true });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.toggleLockSelection();

    expect(a.getAttr("locked")).toBe(true);
    expect(b.getAttr("locked")).toBe(true);
    expect(a.draggable()).toBe(false);
    expect(b.draggable()).toBe(false);
    // Still selected (locking doesn't deselect - it's the only way to
    // reach it again to unlock), just excluded from the transformer.
    expect(canvasManager.selectedShapes).toEqual([a, b]);
    expect(transformer.nodes()).toEqual([]);
  });

  test("toggling again on an all-locked selection unlocks it", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5, draggable: true });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.toggleLockSelection();
    expect(a.getAttr("locked")).toBe(true);

    canvasManager.toggleLockSelection();

    expect(a.getAttr("locked")).toBe(false);
    expect(a.draggable()).toBe(true);
    expect(transformer.nodes()).toEqual([a]);
  });

  test("a mixed locked/unlocked selection locks everything, not toggles each independently", () => {
    const locked = new Circle({ x: 0, y: 0, radius: 5 });
    const unlocked = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(locked);
    canvasManager.addShape(unlocked);
    canvasManager.selectShape(locked);
    canvasManager.toggleLockSelection(); // locked is now locked, unlocked is untouched

    canvasManager.selection.set([locked, unlocked]);
    canvasManager.toggleLockSelection();

    expect(locked.getAttr("locked")).toBe(true);
    expect(unlocked.getAttr("locked")).toBe(true);
  });

  test("emits shapeLockChanged once", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    let events = 0;
    window.eventBus.on("shapeLockChanged", () => {
      events += 1;
    });
    canvasManager.toggleLockSelection();
    expect(events).toBe(1);
  });

  test("a locked shape can still be selected", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.toggleLockSelection();
    canvasManager.deselectShape();

    canvasManager.selectShape(a);

    expect(canvasManager.selectedShapes).toEqual([a]);
  });

  test("removeShapes skips a locked shape but still removes the rest of the batch, and reports that something was removed", () => {
    const locked = new Circle({ x: 0, y: 0, radius: 5 });
    const unlocked = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(locked);
    canvasManager.addShape(unlocked);
    canvasManager.selectShape(locked);
    canvasManager.toggleLockSelection();

    const removedAny = canvasManager.removeShapes([locked, unlocked]);

    expect(canvasManager.shapes).toEqual([locked]);
    expect(removedAny).toBe(true);
  });

  test("removeShapes returns false, removing nothing, when every shape given is locked", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.toggleLockSelection();

    const removedAny = canvasManager.removeShapes([a]);

    expect(removedAny).toBe(false);
    expect(canvasManager.shapes).toEqual([a]);
  });

  // Regression test: Shortcuts.js's Delete handler and cutSelection both
  // used to unconditionally deselect after asking removeShapes to
  // delete the selection, even when removeShapes silently declined
  // because everything selected was locked - a locked shape would stay
  // on the canvas but visibly lose its selection as if Delete/Cut had
  // done something. Caught by an e2e test (e2e/lock.spec.js), not this
  // unit test, but cutSelection's own behavior is covered here directly.
  test("cutSelection leaves an entirely-locked selection selected (it still copies, but doesn't remove or deselect)", () => {
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.toggleLockSelection();

    canvasManager.cutSelection();

    expect(canvasManager.shapes).toEqual([a]);
    expect(canvasManager.selectedShapes).toEqual([a]);
    expect(canvasManager.clipboard.hasContent).toBe(true);
  });

  test("nudgeSelection skips a locked shape but still moves the rest of the selection", () => {
    const locked = new Circle({ x: 0, y: 0, radius: 5 });
    const unlocked = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(locked);
    canvasManager.addShape(unlocked);
    canvasManager.selectShape(locked);
    canvasManager.toggleLockSelection();
    canvasManager.selection.set([locked, unlocked]);

    canvasManager.nudgeSelection(5, 0);

    expect(locked.x()).toBe(0);
    expect(unlocked.x()).toBe(15);
  });

  test("the locked flag round-trips through save/load for every explicit-allow-list shape type", () => {
    const circle = new Circle({ x: 0, y: 0, radius: 5, locked: true });
    canvasManager.addShape(circle);
    expect(canvasManager.toStorageShape(circle).attrs.locked).toBe(true);

    const sticky = new Group({ toolType: "sticky", id: createId() });
    sticky.setAttr("locked", true);
    canvasManager.addShape(sticky);
    expect(canvasManager.toStorageShape(sticky).attrs.locked).toBe(true);

    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();
    const group = canvasManager.selectedShape;
    canvasManager.toggleLockSelection();
    expect(canvasManager.toStorageShape(group).attrs.locked).toBe(true);

    canvasManager.clearCanvas();
    canvasManager.reconstructShapes([
      { type: "Circle", attrs: { x: 0, y: 0, radius: 5, locked: true } },
      {
        type: "Group",
        attrs: {
          x: 0,
          y: 0,
          name: "Group 1",
          locked: true,
          children: [{ type: "Circle", attrs: { x: 0, y: 0, radius: 5 } }],
        },
      },
    ]);
    expect(canvasManager.shapes.map((s) => !!s.getAttr("locked"))).toEqual([
      true,
      true,
    ]);
  });
});

// docs/TASKS.md P2-8: z-order.
describe("CanvasManager z-order", () => {
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

  function addNamed(...names) {
    const shapes = names.map(
      (name) => new Circle({ x: 0, y: 0, radius: 5, name })
    );
    shapes.forEach((s) => canvasManager.addShape(s));
    return shapes;
  }

  function names() {
    return canvasManager.shapes.map((s) => s.getAttr("name"));
  }

  test("each is a no-op with nothing selected", () => {
    addNamed("A", "B");
    let events = 0;
    window.eventBus.on("shapeZOrderChanged", () => {
      events += 1;
    });

    canvasManager.bringToFront();
    canvasManager.sendToBack();
    canvasManager.bringForward();
    canvasManager.sendBackward();

    expect(events).toBe(0);
    expect(names()).toEqual(["A", "B"]);
  });

  test("bringToFront moves the selection above everything, preserving its own relative order", () => {
    const [a, b] = addNamed("A", "B", "C", "D");
    canvasManager.selection.set([b, a]); // selected out of original order

    canvasManager.bringToFront();

    expect(names()).toEqual(["C", "D", "A", "B"]);
    // Konva's actual paint order (mainLayer children) matches too, not
    // just the JS array.
    expect(mainLayer.getChildren().map((s) => s.getAttr("name"))).toEqual([
      "C",
      "D",
      "A",
      "B",
    ]);
  });

  test("sendToBack moves the selection below everything, preserving its own relative order", () => {
    const [a, b] = addNamed("A", "B", "C", "D");
    canvasManager.selection.set([b, a]);

    canvasManager.sendToBack();

    expect(names()).toEqual(["A", "B", "C", "D"]);
  });

  test("bringForward moves each selected shape up past its nearest unselected neighbor", () => {
    const [, b, , d] = addNamed("A", "B", "C", "D", "E");
    canvasManager.selection.set([b, d]);

    canvasManager.bringForward();

    expect(names()).toEqual(["A", "C", "B", "E", "D"]);
  });

  test("bringForward shifts a contiguous selected block up by one, keeping the block's own order", () => {
    addNamed("A", "B", "C", "D", "E");
    canvasManager.selection.set([
      canvasManager.shapes[2],
      canvasManager.shapes[3],
    ]); // C, D

    canvasManager.bringForward();

    expect(names()).toEqual(["A", "B", "E", "C", "D"]);
  });

  test("bringForward on an already-topmost selection changes nothing", () => {
    addNamed("A", "B", "C");
    canvasManager.selection.set([canvasManager.shapes[2]]); // C, already on top

    canvasManager.bringForward();

    expect(names()).toEqual(["A", "B", "C"]);
  });

  test("sendBackward moves each selected shape down past its nearest unselected neighbor", () => {
    addNamed("A", "B", "C", "D", "E");
    canvasManager.selection.set([
      canvasManager.shapes[1],
      canvasManager.shapes[3],
    ]); // B, D

    canvasManager.sendBackward();

    expect(names()).toEqual(["B", "A", "D", "C", "E"]);
  });

  test("sendBackward on an already-bottommost selection changes nothing", () => {
    addNamed("A", "B", "C");
    canvasManager.selection.set([canvasManager.shapes[0]]); // A, already at the bottom

    canvasManager.sendBackward();

    expect(names()).toEqual(["A", "B", "C"]);
  });

  test("emits shapeZOrderChanged once per call, regardless of how many shapes moved", () => {
    addNamed("A", "B", "C");
    canvasManager.selection.set([
      canvasManager.shapes[0],
      canvasManager.shapes[1],
    ]);

    let events = 0;
    window.eventBus.on("shapeZOrderChanged", () => {
      events += 1;
    });
    canvasManager.bringToFront();

    expect(events).toBe(1);
  });
});

// docs/TASKS.md P2-9: align and distribute.
describe("CanvasManager align/distribute", () => {
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

  const ALIGN_METHODS = [
    "alignLeft",
    "alignCenter",
    "alignRight",
    "alignTop",
    "alignMiddle",
    "alignBottom",
    "distributeHorizontally",
    "distributeVertically",
  ];

  test.each(ALIGN_METHODS)(
    "%s is a no-op with fewer than 2 shapes selected",
    (method) => {
      const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
      canvasManager.addShape(a);
      canvasManager.selectShape(a);

      let events = 0;
      window.eventBus.on("shapeAligned", () => {
        events += 1;
      });
      canvasManager[method]();

      expect(events).toBe(0);
      expect(a.x()).toBe(0);
      expect(a.y()).toBe(0);
    }
  );

  test("alignLeft moves every shape's left edge to the selection's leftmost edge", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 });
    const b = new Rect({ x: 100, y: 0, width: 30, height: 30 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.alignLeft();

    expect(a.x()).toBe(0);
    expect(b.x()).toBe(0);
  });

  test("alignCenter aligns every shape's horizontal center to the selection bounds' center", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 }); // center 25
    const b = new Rect({ x: 100, y: 0, width: 30, height: 30 }); // center 115
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.alignCenter();

    // bounds: left 0, right 130, center 65
    expect(a.x() + a.width() / 2).toBe(65);
    expect(b.x() + b.width() / 2).toBe(65);
  });

  test("alignRight moves every shape's right edge to the selection's rightmost edge", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 }); // right 50
    const b = new Rect({ x: 100, y: 0, width: 30, height: 30 }); // right 130
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.alignRight();

    expect(a.x() + a.width()).toBe(130);
    expect(b.x() + b.width()).toBe(130);
  });

  test("alignTop moves every shape's top edge to the selection's topmost edge", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 });
    const b = new Rect({ x: 0, y: 100, width: 30, height: 30 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.alignTop();

    expect(a.y()).toBe(0);
    expect(b.y()).toBe(0);
  });

  test("alignMiddle aligns every shape's vertical center to the selection bounds' center", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 }); // center 25
    const b = new Rect({ x: 0, y: 100, width: 30, height: 30 }); // center 115
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.alignMiddle();

    expect(a.y() + a.height() / 2).toBe(65);
    expect(b.y() + b.height() / 2).toBe(65);
  });

  test("alignBottom moves every shape's bottom edge to the selection's bottommost edge", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 }); // bottom 50
    const b = new Rect({ x: 0, y: 100, width: 30, height: 30 }); // bottom 130
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.alignBottom();

    expect(a.y() + a.height()).toBe(130);
    expect(b.y() + b.height()).toBe(130);
  });

  test("a locked shape's bounds still count toward alignment, but it never moves itself", () => {
    const locked = new Rect({ x: 100, y: 0, width: 30, height: 30 });
    const other = new Rect({ x: 0, y: 0, width: 50, height: 50 });
    canvasManager.addShape(locked);
    canvasManager.addShape(other);
    canvasManager.selectShape(locked);
    canvasManager.toggleLockSelection();
    canvasManager.selection.set([locked, other]);

    canvasManager.alignLeft();

    // Bounds are still [0, 130) (locked shape's own box counted), so
    // `other` aligns to 0 - but `locked` itself stays at x=100.
    expect(locked.x()).toBe(100);
    expect(other.x()).toBe(0);
  });

  test("emits shapeAligned once for a real move, and not at all when nothing actually moves", () => {
    const a = new Rect({ x: 0, y: 0, width: 50, height: 50 });
    const b = new Rect({ x: 100, y: 0, width: 30, height: 30 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    let events = 0;
    window.eventBus.on("shapeAligned", () => {
      events += 1;
    });

    canvasManager.alignLeft();
    expect(events).toBe(1);

    canvasManager.alignLeft(); // already aligned - nothing left to move
    expect(events).toBe(1);
  });

  test("distributeHorizontally evenly spaces the gaps between shapes, leaving the leftmost and rightmost in place", () => {
    const a = new Rect({ x: 0, y: 0, width: 20, height: 10 });
    const b = new Rect({ x: 50, y: 0, width: 10, height: 10 });
    const c = new Rect({ x: 200, y: 0, width: 20, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.addShape(c);
    canvasManager.selection.set([a, b, c]);

    canvasManager.distributeHorizontally();

    expect(a.x()).toBe(0); // leftmost - unchanged
    expect(c.x()).toBe(200); // rightmost - unchanged
    expect(b.x()).toBe(105); // gap of 85 on each side
    // Gap from a's right edge to b's left edge equals the gap from b's
    // right edge to c's left edge.
    const gap1 = b.x() - (a.x() + a.width());
    const gap2 = c.x() - (b.x() + b.width());
    expect(gap1).toBeCloseTo(gap2, 5);
  });

  test("distributeHorizontally spaces multiple shapes between the endpoints evenly", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 20, y: 0, width: 10, height: 10 });
    const c = new Rect({ x: 40, y: 0, width: 10, height: 10 });
    const d = new Rect({ x: 100, y: 0, width: 10, height: 10 });
    [a, b, c, d].forEach((s) => canvasManager.addShape(s));
    canvasManager.selection.set([a, b, c, d]);

    canvasManager.distributeHorizontally();

    expect(a.x()).toBe(0);
    expect(d.x()).toBe(100);
    const gap1 = b.x() - (a.x() + a.width());
    const gap2 = c.x() - (b.x() + b.width());
    const gap3 = d.x() - (c.x() + c.width());
    expect(gap1).toBeCloseTo(gap2, 5);
    expect(gap2).toBeCloseTo(gap3, 5);
  });

  test("distributeVertically evenly spaces the gaps between shapes, leaving the topmost and bottommost in place", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 20 });
    const b = new Rect({ x: 0, y: 50, width: 10, height: 10 });
    const c = new Rect({ x: 0, y: 200, width: 10, height: 20 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.addShape(c);
    canvasManager.selection.set([a, b, c]);

    canvasManager.distributeVertically();

    expect(a.y()).toBe(0);
    expect(c.y()).toBe(200);
    expect(b.y()).toBe(105);
  });

  test("distributeHorizontally with only 2 shapes changes nothing (they're already the two endpoints)", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 100, y: 0, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    canvasManager.distributeHorizontally();

    expect(a.x()).toBe(0);
    expect(b.x()).toBe(100);
  });

  test("a locked middle shape in a distribute never moves, even though it counts toward the spacing", () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const locked = new Rect({ x: 20, y: 0, width: 10, height: 10 });
    const c = new Rect({ x: 200, y: 0, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(locked);
    canvasManager.addShape(c);
    canvasManager.selectShape(locked);
    canvasManager.toggleLockSelection();
    canvasManager.selection.set([a, locked, c]);

    canvasManager.distributeHorizontally();

    expect(locked.x()).toBe(20); // never moved
    expect(a.x()).toBe(0);
    expect(c.x()).toBe(200);
  });
});

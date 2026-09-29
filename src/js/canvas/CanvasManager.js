import { Text } from "konva/lib/shapes/Text";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { RegularPolygon } from "konva/lib/shapes/RegularPolygon";
import { Star } from "konva/lib/shapes/Star";
import { Group } from "konva/lib/Group";
import Konva from "konva";
import { createId } from "../core/Document.js";
import { Selection } from "./Selection.js";
import { Clipboard } from "./Clipboard.js";

// Default paste/duplicate offset (docs/TASKS.md P2-4): visibly distinct
// from the original without straying far, and consistently diagonal so
// repeated pastes/duplicates fan out instead of stacking exactly on top
// of each other.
const CLIPBOARD_OFFSET = { x: 20, y: 20 };

export class CanvasManager {
  // `transformer` is optional (existing tests construct a CanvasManager
  // without one, and nothing here breaks without it - _syncTransformer
  // just no-ops) - main.js is the one real caller that passes its own
  // Konva.Transformer, so multi-select (docs/TASKS.md P2-1) can keep it
  // in sync with the selection itself instead of main.js reaching back
  // in via the selectShape/deselectShape monkey-patch this replaces.
  constructor(stage, mainLayer, tooltipLayer, transformer = null) {
    this.stage = stage;
    this.mainLayer = mainLayer;
    this.tooltipLayer = tooltipLayer;
    this.transformer = transformer;
    this.selection = new Selection();
    this.clipboard = new Clipboard();
    this.shapes = [];
    this.connections = [];
    this.textManager = null;
    this.toolManager = null;

    this.setupEventListeners();
  }

  /** The most recently selected shape, or null - for UI that only ever
   * cares about one shape (the properties panel's fields, single-shape
   * paths elsewhere). See Selection.primary for what "most recent"
   * means. Multi-aware code should use `selectedShapes` instead. */
  get selectedShape() {
    return this.selection.primary;
  }

  /** Every currently selected shape, as a plain array. */
  get selectedShapes() {
    return this.selection.shapes;
  }

  setTextManager(textManager) {
    this.textManager = textManager;
  }

  setToolManager(toolManager) {
    this.toolManager = toolManager;
  }

  toStorageShape(shape) {
    if (
      shape.getClassName() === "Group" &&
      shape.getAttr("toolType") === "sticky"
    ) {
      const rect = shape.findOne("Rect");
      const textNode = shape.findOne("Text");
      return {
        type: "StickyNote",
        attrs: {
          id: shape.id(),
          x: shape.x(),
          y: shape.y(),
          rotation: shape.rotation(),
          scaleX: shape.scaleX(),
          scaleY: shape.scaleY(),
          opacity: shape.opacity(),
          name: shape.name(),
          rect: rect ? rect.getAttrs() : {},
          text: textNode
            ? {
                ...textNode.getAttrs(),
                text: textNode.text(),
              }
            : {},
        },
      };
    }
    const type = shape.getClassName();
    if (type === "Image") {
      // Image nodes carry the live HTMLImageElement under the "image"
      // attr, which is not serializable (and not meaningful) JSON, so
      // this type gets an explicit allow-list instead of the generic
      // attrs spread used below. iconFile is the origin-independent
      // asset reference for a bundled SVG icon (SVGManager.createSVG);
      // imageSrc is a self-contained data: URL for an image pasted from
      // the system clipboard (docs/TASKS.md P2-4, ShapeManager.
      // createImageFromDataUrl) - there is no bundled asset file to
      // reference, so the pixels themselves are embedded directly. A
      // shape only ever carries one of the two.
      const attrs = shape.getAttrs();
      const base = {
        id: shape.id(),
        x: shape.x(),
        y: shape.y(),
        width: shape.width(),
        height: shape.height(),
        rotation: shape.rotation(),
        scaleX: shape.scaleX(),
        scaleY: shape.scaleY(),
        opacity: shape.opacity(),
        draggable: shape.draggable(),
        name: shape.getAttr("name") || "",
      };
      return {
        type,
        attrs: attrs.iconFile
          ? { ...base, iconFile: attrs.iconFile }
          : { ...base, imageSrc: attrs.imageSrc || "" },
      };
    }
    const attrs = shape.getAttrs();
    return {
      type,
      attrs: {
        ...attrs,
        name: shape.getAttr("name") || "",
        text: shape.getAttr("text") || "",
      },
    };
  }

  setupEventListeners() {
    this.stage.on("click", (e) => {
      if (e.target === this.stage) {
        // See ToolManager.consumeSuppressedClick's own comment: a real
        // marquee drag (docs/TASKS.md P2-2) sets this the moment it's
        // confirmed to be a real drag, specifically so it's already
        // true by the time this fires - without it, this handler would
        // immediately deselect whatever the marquee just selected.
        if (this.toolManager?.consumeSuppressedClick()) return;
        this.deselectShape();
      }
    });

    window.eventBus.on("shapeSelected", (shape) => {
      this.selectShape(shape);
    });

    window.eventBus.on("shapeDeselected", () => {
      this.deselectShape();
    });

    // Shift-click (docs/TASKS.md P2-1): toggles one shape's membership
    // without touching the rest of the selection. Emitted by
    // setupShapeEvents' own click handler below, kept as a separate
    // event from "shapeSelected" (which always replaces the whole
    // selection with just its one shape) rather than overloading that
    // event with a shiftKey flag, since every other "shapeSelected"
    // emitter (shape creation in ToolManager/TextManager/SVGManager)
    // means "this new shape is now the selection", never "add to it".
    window.eventBus.on("shapeToggled", (shape) => {
      this.toggleSelect(shape);
    });
  }

  /** Replaces the whole selection with just this one shape - what a
   * plain (non-Shift) click, or creating a new shape, means. */
  selectShape(shape) {
    this.selection.selectOnly(shape);
    this._afterSelectionChanged();
  }

  /** Shift-click: adds `shape` to the selection if it wasn't already
   * there, removes it if it was - the rest of the selection is
   * untouched either way. */
  toggleSelect(shape) {
    this.selection.toggle(shape);
    this._afterSelectionChanged();
  }

  /** Every shape becomes selected (Ctrl+A). */
  selectAll() {
    this.selectShapes(this.shapes);
  }

  /** Selects every shape given (docs/TASKS.md P2-2's marquee select is
   * the main caller, with a whole batch at once rather than one shape
   * at a time): replaces the whole selection, or unions into it when
   * `additive` is true (Shift held during the marquee drag) - the same
   * union semantics toggleSelect gives a single shift-clicked shape,
   * just for a batch. */
  selectShapes(shapes, { additive = false } = {}) {
    if (additive) {
      shapes.forEach((shape) => this.selection.add(shape));
    } else {
      this.selection.set(shapes);
    }
    this._afterSelectionChanged();
  }

  /** Clears the selection entirely - a plain click on empty canvas,
   * Escape, or any single/multi delete. */
  deselectShape() {
    if (this.selection.size > 0) {
      this.selection.clear();
      this._afterSelectionChanged();
    }
  }

  /** Common tail of every selection-changing method above: redraws,
   * tells the properties panel what to show (still just the primary
   * shape - a full multi-shape properties panel is P3-5's job, not
   * this phase's), and keeps the transformer's wrapped nodes in sync
   * with the selection itself. */
  _afterSelectionChanged() {
    this.mainLayer.batchDraw();
    window.eventBus.emit("propertiesUpdate", this.selection.primary);
    this._syncTransformer();
  }

  // Replaces main.js's old post-construction monkey-patch of
  // selectShape/deselectShape (it needed to reach in from outside
  // specifically to keep the transformer's wrapped nodes in sync, back
  // when there was only ever one selected shape to hand it). Now that
  // selection is a set, this lives here instead, next to the selection
  // state it's keeping in sync, and every selection-changing method
  // goes through it via _afterSelectionChanged rather than each needing
  // its own copy of this logic.
  _syncTransformer() {
    if (!this.transformer) return;
    // A Text node mid-inline-edit (TextManager sets isEditing while its
    // textarea overlay is open) is deliberately excluded: attaching the
    // transformer to it would visually fight with that overlay. This
    // generalizes what was previously a single-shape special case to a
    // filter, since a multi-select could in principle include a shape
    // currently being edited alongside others that aren't.
    const nodes = this.selection.shapes.filter(
      (shape) => !(shape.getClassName() === "Text" && shape.isEditing)
    );
    this.transformer.nodes(nodes);
    // A single freshly-created/short Text node's own attrs (e.g. the
    // default 200px width) don't necessarily match its actual rendered
    // bounds, so the transformer needs an explicit override to visually
    // wrap the real text rather than the nominal shape size - only
    // meaningful for exactly one selected Text node; Konva's Transformer
    // already computes its own encompassing box correctly across
    // multiple nodes on its own.
    if (nodes.length === 1 && nodes[0].getClassName() === "Text") {
      const box = nodes[0].getClientRect();
      this.transformer.setAttrs({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
  }

  addShape(shape) {
    this.shapes.push(shape);
    this.mainLayer.add(shape);
    if (this.toolManager) {
      this.toolManager.registerNewShape(shape);
    }
    this.mainLayer.batchDraw();
  }

  removeShape(shape) {
    const index = this.shapes.indexOf(shape);
    if (index > -1) {
      this.shapes.splice(index, 1);
      this.selection.remove(shape);
      shape.destroy();
      this.mainLayer.batchDraw();
      window.eventBus.emit("shapeRemoved");
    }
  }

  // Removes every shape given in one batch - used by multi-select
  // delete/cut (docs/TASKS.md P2-1/P2-4) instead of calling removeShape
  // in a loop, which would emit "shapeRemoved" once per shape and, with
  // it, commit a separate undo checkpoint for each one - so selecting 3
  // shapes and pressing Delete would need 3 presses of Ctrl+Z to bring
  // them all back instead of 1. One emission here means one commit.
  removeShapes(shapes) {
    let removedAny = false;
    shapes.forEach((shape) => {
      const index = this.shapes.indexOf(shape);
      if (index > -1) {
        this.shapes.splice(index, 1);
        this.selection.remove(shape);
        shape.destroy();
        removedAny = true;
      }
    });
    if (removedAny) {
      this.mainLayer.batchDraw();
      window.eventBus.emit("shapeRemoved");
    }
  }

  /** Copies the current selection's shapes into this app's own in-memory
   * clipboard (see Clipboard.js for why it's not the OS clipboard). A
   * no-op with nothing selected - it does not clear a previous copy. */
  copySelection() {
    if (this.selection.size === 0) return;
    this.clipboard.write(
      this.selectedShapes.map((shape) => this.toStorageShape(shape))
    );
  }

  /** Copies the current selection, then removes it - one removeShapes
   * call, so (like Delete) it commits a single undo checkpoint rather
   * than one per shape. */
  cutSelection() {
    if (this.selection.size === 0) return;
    this.copySelection();
    const shapes = this.selectedShapes;
    this.deselectShape();
    this.removeShapes(shapes);
  }

  /** Pastes whatever this app's clipboard is currently holding, offset
   * from where it was copied so it doesn't land exactly on top of the
   * original, and selects the newly-pasted shapes. A no-op if nothing
   * has been copied/cut yet. */
  pasteClipboard(offset = CLIPBOARD_OFFSET) {
    const stored = this.clipboard.read();
    if (!stored) return;
    this._instantiateOffset(stored, offset);
  }

  /** Copies the current selection and immediately pastes it back with an
   * offset, without touching the clipboard - so duplicating a shape never
   * clobbers whatever a previous real copy would otherwise paste. */
  duplicateSelection(offset = CLIPBOARD_OFFSET) {
    if (this.selection.size === 0) return;
    const stored = this.selectedShapes.map((shape) =>
      this.toStorageShape(shape)
    );
    this._instantiateOffset(stored, offset);
  }

  // Shared tail of pasteClipboard/duplicateSelection: rebuilds each
  // stored shape with a fresh id and an offset position, waits for every
  // one of them to actually land (reconstructShapes' onSettled - Image
  // shapes load asynchronously, everything else is synchronous, and
  // mixing the two is exactly why onSettled counts rather than assuming
  // reconstructShapes is done when it returns), then selects the whole
  // pasted/duplicated batch and emits a single "shapeAdded" - one undo
  // checkpoint for the whole paste, the same reasoning as removeShapes'
  // single "shapeRemoved" above.
  _instantiateOffset(storedShapes, offset) {
    if (storedShapes.length === 0) return;
    const objects = storedShapes.map((stored) => ({
      type: stored.type,
      attrs: {
        ...stored.attrs,
        id: createId(),
        x: (stored.attrs.x ?? 0) + offset.x,
        y: (stored.attrs.y ?? 0) + offset.y,
      },
    }));
    const landed = [];
    let settled = 0;
    const finish = () => {
      if (landed.length > 0) this.selectShapes(landed);
      window.eventBus.emit("shapeAdded");
    };
    this.reconstructShapes(objects, {
      onSettled: (shape) => {
        if (shape) landed.push(shape);
        settled += 1;
        if (settled === objects.length) finish();
      },
    });
  }

  // Bridge to the core/Document.js v2 schema (docs/TASKS.md P1-1). Kept
  // here rather than in Document.js itself, which is deliberately
  // Konva-agnostic: this is the one place that knows how to walk live
  // Konva nodes, and it reuses toStorageShape/reconstructShapes (already
  // covered by their own tests) rather than duplicating their per-type
  // logic. zIndex comes from array position, the same source of truth
  // addShape has always used for stacking order.
  toDocumentObjects() {
    return this.shapes.map((shape, index) => {
      const stored = this.toStorageShape(shape);
      return {
        id: stored.attrs.id || shape.id() || createId("obj"),
        type: stored.type,
        zIndex: index,
        attrs: stored.attrs,
      };
    });
  }

  // Accepts document.objects (docs/TASKS.md P1-1's schema: unordered is
  // fine, each carries its own zIndex) rather than requiring the caller
  // to have already sorted them.
  loadDocumentObjects(objects) {
    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    this.reconstructShapes(
      sorted.map((obj) => ({
        type: obj.type,
        attrs: { ...obj.attrs, id: obj.attrs.id || obj.id },
      }))
    );
  }

  // Import (docs/TASKS.md P1-7) merge mode: adds another document's
  // objects onto the current canvas without removing what's already
  // there (unlike loadDocumentObjects, which is a full replace). Any
  // incoming id that collides with a shape already on the canvas is
  // replaced with a fresh one - two independently-exported documents
  // have no reason to share an id, and a duplicate would break
  // id-based lookups like updateConnections' shape.id() === connection.from
  // scans. The incoming objects are still sorted by their own zIndex
  // first so their relative order is preserved; reconstructShapes/
  // addShape then appends them after everything already on the canvas,
  // which becomes their new stacking position (toDocumentObjects always
  // derives zIndex from array position, not a stored field).
  mergeDocumentObjects(objects) {
    const existingIds = new Set(this.shapes.map((shape) => shape.id()));
    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    this.reconstructShapes(
      sorted.map((obj) => {
        const incomingId = obj.attrs.id || obj.id;
        const id =
          incomingId && !existingIds.has(incomingId)
            ? incomingId
            : createId("obj");
        return { type: obj.type, attrs: { ...obj.attrs, id } };
      })
    );
  }

  // `onSettled(shape | null)` (docs/TASKS.md P2-4) fires exactly once per
  // input object, in the same order for the synchronous types but not
  // necessarily for Image (its fromURL load is async, so it can settle
  // after later synchronous entries already have) - null means the
  // object produced no shape (unknown type, or an Image with neither
  // iconFile nor imageSrc). Every existing caller (load, import's merge,
  // undo/redo's applyCanvasSnapshot) omits it and is unaffected; paste/
  // duplicate (below) use it to know when every pasted object - Image's
  // async ones included - has actually landed, so they select the whole
  // pasted batch and commit one history checkpoint only once, not one at
  // a time as each shape happens to finish.
  reconstructShapes(shapes, { onSettled } = {}) {
    shapes.forEach((shapeData) => {
      let shape;
      const type = shapeData.type;
      const attrs = shapeData.attrs;
      switch (type) {
        case "Circle":
          shape = new Circle(attrs);
          break;
        case "Rect":
          shape = new Rect(attrs);
          break;
        case "Line":
          shape = new Line(attrs);
          break;
        case "RegularPolygon":
          shape = new RegularPolygon(attrs);
          break;
        case "Star":
          shape = new Star(attrs);
          break;
        case "Text":
          shape = new Text({
            ...attrs,
            draggable: true,
            width: attrs.width || 200,
            padding: attrs.padding || 5,
          });
          if (this.textManager) {
            this.textManager.setupTextEvents(shape);
          }
          break;
        case "StickyNote": {
          const rectAttrs = attrs.rect || {};
          const textAttrs = attrs.text || {};
          const group = new Group({
            id: attrs.id || createId(),
            x: attrs.x ?? 0,
            y: attrs.y ?? 0,
            rotation: attrs.rotation ?? 0,
            scaleX: attrs.scaleX ?? 1,
            scaleY: attrs.scaleY ?? 1,
            opacity: attrs.opacity ?? 1,
            name: attrs.name || "Note",
            toolType: "sticky",
            draggable: true,
          });
          const rectNode = new Rect({
            width: 200,
            height: 140,
            ...rectAttrs,
          });
          const { text: noteText, ...textRest } = textAttrs;
          const textNode = new Text({
            x: 10,
            y: 10,
            width: 180,
            fontSize: 14,
            fontFamily: "Poppins",
            fill: "#333333",
            ...textRest,
            text: noteText || "Double click to edit",
          });
          group.add(rectNode);
          group.add(textNode);
          if (this.textManager) {
            this.textManager.setupStickyNote(group);
          }
          this.setupShapeEvents(group, "StickyNote");
          this.addShape(group);
          onSettled?.(group);
          return;
        }
        case "Image": {
          // Prefer the relative iconFile key (current format). Fall back
          // to the legacy absolute svgUrl saved by older versions of
          // this app: the folder convention (assets/svgs/<file>) never
          // changed, so the basename of that stale URL still identifies
          // the right icon even though the full URL (baked to whatever
          // origin/path was live when it was saved) is not directly
          // usable. This keeps pre-fix saved drawings loadable rather
          // than silently dropping those shapes. imageSrc (docs/TASKS.md
          // P2-4) is the other possible source: a self-contained data:
          // URL for an image pasted from the system clipboard, with no
          // bundled asset file to fall back to at all.
          const iconFile =
            attrs.iconFile || (attrs.svgUrl || "").split("/").pop() || "";
          const imageSrc = !iconFile ? attrs.imageSrc || "" : "";
          if (!iconFile && !imageSrc) break;
          const url = iconFile ? `assets/svgs/${iconFile}` : imageSrc;
          Konva.Image.fromURL(
            url,
            (image) => {
              image.setAttrs({
                id: attrs.id || createId(),
                x: attrs.x,
                y: attrs.y,
                width: attrs.width,
                height: attrs.height,
                rotation: attrs.rotation || 0,
                scaleX: attrs.scaleX ?? 1,
                scaleY: attrs.scaleY ?? 1,
                opacity: attrs.opacity ?? 1,
                name: attrs.name || "",
                draggable: true,
                ...(iconFile ? { iconFile } : { imageSrc }),
              });
              this.setupShapeEvents(image, iconFile ? "SVG" : "Image");
              this.addShape(image);
              onSettled?.(image);
            },
            () => {
              console.warn(
                iconFile
                  ? `FrameX: could not load saved icon "${iconFile}" ` +
                      `(from ${url}); the shape was dropped from the ` +
                      `restored canvas.`
                  : "FrameX: could not load a pasted image; the shape " +
                      "was dropped from the restored canvas."
              );
              onSettled?.(null);
            }
          );
          return;
        }
        default:
          break;
      }
      if (shape) {
        this.setupShapeEvents(shape, type);
        this.addShape(shape);
      }
      onSettled?.(shape || null);
    });
  }

  // The single, canonical event wiring for every shape type (basic
  // shapes, freehand strokes, sticky notes, SVG icons all funnel through
  // here - see ShapeManager, ToolManager and SVGManager). Do not
  // maintain a second copy of this elsewhere: a duplicated copy in
  // ShapeManager (removed in docs/TASKS.md P0-10) was missing the
  // dragend -> "shapeDragEnded" emission below, so dragging any basic
  // shape (circle, rect, square, triangle, star, line - i.e. anything
  // created from the shapes menu) never committed a history checkpoint
  // for its new position; pressing Ctrl+Z after such a drag undid the
  // shape's *creation* instead of just its move, deleting it outright.
  setupShapeEvents(shape, name) {
    // Shift-click toggles this one shape's membership without touching
    // the rest of the selection (docs/TASKS.md P2-1); a plain click
    // replaces the whole selection with just this shape, same as
    // before multi-select existed. Konva only fires "click" when the
    // pointer didn't move between down and up - an actual drag never
    // reaches here, so this can't misfire mid-drag.
    shape.on("click", (e) => {
      if (e.evt?.shiftKey) {
        window.eventBus.emit("shapeToggled", shape);
      } else {
        window.eventBus.emit("shapeSelected", shape);
      }
    });

    shape.on("mouseover", () => {
      this.updateTooltip(name, shape.x(), shape.y());
    });

    shape.on("mouseout", () => {
      this.hideTooltip();
    });

    // Dragging any one shape that's part of a multi-shape selection
    // already moves the whole selection together, for free: Konva's
    // own Transformer (docs/TASKS.md P2-1's _syncTransformer keeps it
    // wrapping every selected node) implements exactly this via its
    // internal _proxyDrag - wired the moment a node is passed to
    // transformer.nodes([...]), which _syncTransformer already does on
    // every selection change. An earlier version of this method
    // duplicated that logic by hand (tracking each selected shape's
    // drag-start position and re-applying the same delta), which
    // fought with the Transformer's own built-in handling of the exact
    // same drag and compounded into visibly wrong movement - caught by
    // a Playwright-driven real mouse drag in e2e/selection.spec.js
    // landing shapes tens of pixels off from where the mouse actually
    // went, not by reasoning about Konva's internals up front.
    shape.on("dragmove", () => {
      this.mainLayer.batchDraw();
      this.updateConnections();
      this.hideTooltip();
    });

    shape.on("dragend", () => {
      window.eventBus.emit("shapeDragEnded");
    });
  }

  // Minimal hover tooltip on the dedicated tooltipLayer (already created
  // and passed in by main.js, but previously unused: SVGManager called
  // these two methods on every icon mouseover/mouseout, and since they
  // did not exist, hovering an SVG icon threw a TypeError. That code
  // path was unreachable in production until this same change fixed
  // the icon build/persistence pipeline (docs/TASKS.md P0-3), which is
  // why the crash was never observed in practice.
  updateTooltip(text, x, y) {
    if (!this.tooltipLayer) return;
    this.hideTooltip();
    const label = new Konva.Label({
      x: x + 12,
      y: y - 12,
      listening: false,
    });
    label.add(
      new Konva.Tag({
        fill: "#1f2937",
        cornerRadius: 4,
        pointerDirection: "left",
        pointerWidth: 6,
        pointerHeight: 6,
        shadowColor: "black",
        shadowBlur: 4,
        shadowOpacity: 0.2,
      })
    );
    label.add(
      new Konva.Text({
        text: text || "",
        fontFamily: "Poppins, sans-serif",
        fontSize: 12,
        padding: 6,
        fill: "#ffffff",
      })
    );
    this._tooltipLabel = label;
    this.tooltipLayer.add(label);
    this.tooltipLayer.batchDraw();
  }

  hideTooltip() {
    if (this._tooltipLabel) {
      this._tooltipLabel.destroy();
      this._tooltipLabel = null;
      this.tooltipLayer?.batchDraw();
    }
  }

  updateConnections() {
    this.connections.forEach((connection) => {
      const fromShape = this.shapes.find((s) => s.id() === connection.from);
      const toShape = this.shapes.find((s) => s.id() === connection.to);

      if (fromShape && toShape) {
        const points = this.getConnectionPoints(fromShape, toShape);
        connection.line.points(points);
      }
    });
    this.mainLayer.batchDraw();
  }

  getConnectionPoints(fromShape, toShape) {
    const fromCenter = {
      x: fromShape.x() + fromShape.width() / 2,
      y: fromShape.y() + fromShape.height() / 2,
    };
    const toCenter = {
      x: toShape.x() + toShape.width() / 2,
      y: toShape.y() + toShape.height() / 2,
    };

    return [fromCenter.x, fromCenter.y, toCenter.x, toCenter.y];
  }

  clearCanvas() {
    this.shapes.forEach((shape) => shape.destroy());
    this.shapes = [];
    this.connections = [];
    // Previously left dangling: the selection (in the pre-multi-select
    // days, just `selectedShape`) kept pointing at an already-destroyed
    // node after Clear Canvas if anything was selected first - never
    // observed as a crash only because nothing happened to read it
    // again before the next real selection change, but multi-select
    // code (_syncTransformer, group-drag) does read the selection on
    // essentially every interaction, so a stale reference here is worth
    // closing now rather than waiting to see it fail.
    this.selection.clear();
    this._syncTransformer();
    this.mainLayer.batchDraw();
  }
}

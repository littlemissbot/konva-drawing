import { Text } from "konva/lib/shapes/Text";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { RegularPolygon } from "konva/lib/shapes/RegularPolygon";
import { Star } from "konva/lib/shapes/Star";
import { Group } from "konva/lib/Group";
import Konva from "konva";
import { createId } from "../core/Document.js";

export class CanvasManager {
  constructor(stage, mainLayer, tooltipLayer) {
    this.stage = stage;
    this.mainLayer = mainLayer;
    this.tooltipLayer = tooltipLayer;
    this.selectedShape = null;
    this.shapes = [];
    this.connections = [];
    this.textManager = null;
    this.toolManager = null;

    this.setupEventListeners();
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
      // asset reference; see SVGManager.createSVG for why we don't
      // persist image.image().src (an absolute, origin-baked URL).
      const attrs = shape.getAttrs();
      return {
        type,
        attrs: {
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
          iconFile: attrs.iconFile || "",
        },
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
        this.deselectShape();
      }
    });

    window.eventBus.on("shapeSelected", (shape) => {
      this.selectShape(shape);
    });

    window.eventBus.on("shapeDeselected", () => {
      this.deselectShape();
    });
  }

  selectShape(shape) {
    this.deselectShape();
    this.selectedShape = shape;
    this.mainLayer.batchDraw();
    window.eventBus.emit("propertiesUpdate", shape);
  }

  deselectShape() {
    if (this.selectedShape) {
      this.selectedShape = null;
      this.mainLayer.batchDraw();
      window.eventBus.emit("propertiesUpdate", null);
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
      shape.destroy();
      this.mainLayer.batchDraw();
      window.eventBus.emit("shapeRemoved");
    }
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

  reconstructShapes(shapes) {
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
          // than silently dropping those shapes.
          const iconFile =
            attrs.iconFile || (attrs.svgUrl || "").split("/").pop() || "";
          if (!iconFile) break;
          const url = `assets/svgs/${iconFile}`;
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
                iconFile,
              });
              this.setupShapeEvents(image, "SVG");
              this.addShape(image);
            },
            () => {
              console.warn(
                `FrameX: could not load saved icon "${iconFile}" ` +
                  `(from ${url}); the shape was dropped from the ` +
                  `restored canvas.`
              );
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
    shape.on("click", () => {
      window.eventBus.emit("shapeSelected", shape);
    });

    shape.on("mouseover", () => {
      this.updateTooltip(name, shape.x(), shape.y());
    });

    shape.on("mouseout", () => {
      this.hideTooltip();
    });

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
    this.mainLayer.batchDraw();
  }
}

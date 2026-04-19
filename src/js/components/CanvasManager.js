import { Text } from "konva/lib/shapes/Text";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { RegularPolygon } from "konva/lib/shapes/RegularPolygon";
import { Star } from "konva/lib/shapes/Star";
import { Image } from "konva/lib/shapes/Image";
import { Group } from "konva/lib/Group";
import Konva from "konva";

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
    const attrs = shape.getAttrs();
    let extra = {};
    if (type === "Image") {
      extra.svgUrl =
        shape.image() && shape.image().src
          ? shape.image().src
          : attrs.svgUrl || "";
    }
    return {
      type,
      attrs: {
        ...attrs,
        name: shape.getAttr("name") || "",
        text: shape.getAttr("text") || "",
        ...extra,
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

  saveCanvas() {
    const data = {
      shapes: this.shapes.map((shape) => this.toStorageShape(shape)),
    };
    localStorage.setItem("canvasData", JSON.stringify(data));
  }

  loadCanvas() {
    const data = JSON.parse(localStorage.getItem("canvasData"));
    if (data && data.shapes) {
      this.clearCanvas();
      this.reconstructShapes(data.shapes);
      this.toolManager?.refreshInteractivity();
      this.mainLayer.batchDraw();
    }
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
        case "Image":
          if (attrs.svgUrl) {
            Konva.Image.fromURL(attrs.svgUrl, (image) => {
              image.setAttrs({
                ...attrs,
                image: image.image(),
                draggable: true,
              });
              this.setupShapeEvents(image, "SVG");
              this.addShape(image);
            });
            return;
          }
          break;
        default:
          break;
      }
      if (shape) {
        this.setupShapeEvents(shape, type);
        this.addShape(shape);
      }
    });
  }

  setupShapeEvents(shape, name) {
    shape.on("click", () => {
      window.eventBus.emit("shapeSelected", shape);
    });

    shape.on("dragmove", () => {
      this.mainLayer.batchDraw();
      this.updateConnections();
    });

    shape.on("dragend", () => {
      window.eventBus.emit("shapeDragEnded");
    });
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

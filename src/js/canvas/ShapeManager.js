import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { RegularPolygon } from "konva/lib/shapes/RegularPolygon";
import { Star } from "konva/lib/shapes/Star";
import Konva from "konva";
import { createId } from "../core/Document.js";

// Pasted images (docs/TASKS.md P2-4) are capped to this on their longest
// edge so a full-resolution screenshot doesn't dwarf the canvas - the
// pixels themselves stay embedded at full resolution (see
// createImageFromDataUrl below and CanvasManager.toStorageShape's
// imageSrc), only the on-canvas display size is capped here. Real
// re-encoding to actually shrink the stored pixels, plus a document-size
// warning at 80% of some budget, is docs/TASKS.md P6-2's job (depends on
// P1-4, not this task) - deliberately not built here.
const PASTED_IMAGE_MAX_EDGE = 400;

export class ShapeManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.shapeCounts = {
      Circle: 0,
      Rectangle: 0,
      Square: 0,
      Triangle: 0,
      Line: 0,
      Star: 0,
      Text: 0,
      SVG: 0,
      Image: 0,
    };
  }

  getUniqueName(type) {
    this.shapeCounts[type] = (this.shapeCounts[type] || 0) + 1;
    return `${type} ${this.shapeCounts[type]}`;
  }

  createCircle() {
    const name = this.getUniqueName("Circle");
    const circle = new Circle({
      x: this.canvasManager.stage.width() / 2,
      y: this.canvasManager.stage.height() / 2,
      radius: 25,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
      draggable: true,
      name,
      id: createId(),
    });

    this.canvasManager.setupShapeEvents(circle, "Circle");
    this.canvasManager.addShape(circle);
    window.eventBus.emit("shapeAdded");
  }

  createRectangle() {
    const name = this.getUniqueName("Rectangle");
    const rect = new Rect({
      x: this.canvasManager.stage.width() / 2 - 50,
      y: this.canvasManager.stage.height() / 2 - 25,
      width: 100,
      height: 50,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
      draggable: true,
      name,
      id: createId(),
    });

    this.canvasManager.setupShapeEvents(rect, "Rectangle");
    this.canvasManager.addShape(rect);
    window.eventBus.emit("shapeAdded");
  }

  createSquare() {
    const name = this.getUniqueName("Square");
    const square = new Rect({
      x: this.canvasManager.stage.width() / 2 - 25,
      y: this.canvasManager.stage.height() / 2 - 25,
      width: 50,
      height: 50,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
      draggable: true,
      name,
      id: createId(),
    });

    this.canvasManager.setupShapeEvents(square, "Square");
    this.canvasManager.addShape(square);
    window.eventBus.emit("shapeAdded");
  }

  createTriangle() {
    const name = this.getUniqueName("Triangle");
    const triangle = new RegularPolygon({
      x: this.canvasManager.stage.width() / 2,
      y: this.canvasManager.stage.height() / 2,
      sides: 3,
      radius: 30,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
      draggable: true,
      name,
      id: createId(),
    });

    this.canvasManager.setupShapeEvents(triangle, "Triangle");
    this.canvasManager.addShape(triangle);
    window.eventBus.emit("shapeAdded");
  }

  createLine() {
    const name = this.getUniqueName("Line");
    const line = new Line({
      points: [
        this.canvasManager.stage.width() / 2 - 50,
        this.canvasManager.stage.height() / 2,
        this.canvasManager.stage.width() / 2 + 50,
        this.canvasManager.stage.height() / 2,
      ],
      stroke: "#000000",
      strokeWidth: 2,
      draggable: true,
      name,
      id: createId(),
    });

    this.canvasManager.setupShapeEvents(line, "Line");
    this.canvasManager.addShape(line);
    window.eventBus.emit("shapeAdded");
  }

  createStar() {
    const name = this.getUniqueName("Star");
    const star = new Star({
      x: this.canvasManager.stage.width() / 2,
      y: this.canvasManager.stage.height() / 2,
      numPoints: 5,
      innerRadius: 20,
      outerRadius: 40,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
      draggable: true,
      name,
      id: createId(),
    });

    this.canvasManager.setupShapeEvents(star, "Star");
    this.canvasManager.addShape(star);
    window.eventBus.emit("shapeAdded");
  }

  // System image paste (docs/TASKS.md P2-4): unlike createSVG, there is
  // no bundled asset file to reference by name - dataUrl is the pasted
  // image's own pixels, embedded directly (CanvasManager.toStorageShape's
  // imageSrc), so it round-trips through save/undo/export with nothing
  // else to fetch. Sizing needs the image to actually finish loading
  // first (to read its natural width/height), which Konva.Image.fromURL
  // only reports via callback - unlike every other create* method above,
  // this one can't set final attrs synchronously.
  createImageFromDataUrl(dataUrl, { x, y } = {}) {
    const name = this.getUniqueName("Image");
    Konva.Image.fromURL(
      dataUrl,
      (image) => {
        const naturalWidth = image.width();
        const naturalHeight = image.height();
        const scale = Math.min(
          1,
          PASTED_IMAGE_MAX_EDGE / Math.max(naturalWidth, naturalHeight, 1)
        );
        const width = Math.round(naturalWidth * scale) || 1;
        const height = Math.round(naturalHeight * scale) || 1;
        image.setAttrs({
          x: x ?? this.canvasManager.stage.width() / 2 - width / 2,
          y: y ?? this.canvasManager.stage.height() / 2 - height / 2,
          width,
          height,
          draggable: true,
          name,
          id: createId(),
          imageSrc: dataUrl,
        });
        this.canvasManager.setupShapeEvents(image, name);
        this.canvasManager.addShape(image);
        this.canvasManager.selectShape(image);
        window.eventBus.emit("shapeAdded");
      },
      () => {
        console.warn("FrameX: could not load the pasted image.");
      }
    );
  }
}

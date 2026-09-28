import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { RegularPolygon } from "konva/lib/shapes/RegularPolygon";
import { Star } from "konva/lib/shapes/Star";

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
    });

    this.setupShapeEvents(circle, "Circle");
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
    });

    this.setupShapeEvents(rect, "Rectangle");
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
    });

    this.setupShapeEvents(square, "Square");
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
    });

    this.setupShapeEvents(triangle, "Triangle");
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
    });

    this.setupShapeEvents(line, "Line");
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
    });

    this.setupShapeEvents(star, "Star");
    this.canvasManager.addShape(star);
    window.eventBus.emit("shapeAdded");
  }

  setupShapeEvents(shape, name) {
    shape.on("click", () => {
      window.eventBus.emit("shapeSelected", shape);
    });

    shape.on("dragmove", () => {
      this.canvasManager.mainLayer.batchDraw();
    });
  }
}

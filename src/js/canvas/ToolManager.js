import { Line } from "konva/lib/shapes/Line";
import { Group } from "konva/lib/Group";
import { Rect } from "konva/lib/shapes/Rect";
import { Text } from "konva/lib/shapes/Text";

const TOOL_CURSOR = "cursor";
const TOOL_PEN = "pen";
const TOOL_NOTE = "note";

export class ToolManager {
  constructor({ stage, canvasManager, textManager, transformer }) {
    this.stage = stage;
    this.canvasManager = canvasManager;
    this.textManager = textManager;
    this.transformer = transformer;
    this.tool = TOOL_CURSOR;
    this.isDrawing = false;
    this.currentLine = null;
    this.freehandCount = 0;
    this.stickyCount = 0;
    this._boundPenUp = this._finishPenStroke.bind(this);
    this._bindPenDrawing();
    this._bindStickyPlacement();
    this.setTool(TOOL_CURSOR);
  }

  getTool() {
    return this.tool;
  }

  setTool(tool) {
    if (![TOOL_CURSOR, TOOL_PEN, TOOL_NOTE].includes(tool)) return;
    if (this.tool === TOOL_PEN && this.isDrawing) {
      this._finishPenStroke();
    }
    this.tool = tool;
    if (tool !== TOOL_CURSOR) {
      this.transformer.nodes([]);
      this.canvasManager.deselectShape();
    }
    this.refreshInteractivity();
    this._updateToolbarUi();
    this._updateStageCursor();
  }

  refreshInteractivity() {
    this._syncShapePointerMode();
  }

  _updateToolbarUi() {
    const map = {
      [TOOL_CURSOR]: "selectTool",
      [TOOL_PEN]: "pencilTool",
      [TOOL_NOTE]: "stickyTool",
    };
    document.querySelectorAll(".left-toolbar .toolbar-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    const id = map[this.tool];
    const el = id ? document.getElementById(id) : null;
    if (el) el.classList.add("active");
  }

  _updateStageCursor() {
    const container = this.stage.container();
    if (!container) return;
    if (this.tool === TOOL_PEN) {
      container.style.cursor = "crosshair";
    } else if (this.tool === TOOL_NOTE) {
      container.style.cursor = "cell";
    } else {
      container.style.cursor = "default";
    }
  }

  _syncShapePointerMode() {
    const cursorLike = this.tool === TOOL_CURSOR;
    const penMode = this.tool === TOOL_PEN;
    this.canvasManager.shapes.forEach((shape) => {
      shape.draggable(cursorLike);
      shape.listening(!penMode);
    });
  }

  registerNewShape(shape) {
    const cursorLike = this.tool === TOOL_CURSOR;
    const penMode = this.tool === TOOL_PEN;
    shape.draggable(cursorLike);
    shape.listening(!penMode);
  }

  _bindPenDrawing() {
    this.stage.on("mousedown touchstart", (e) => {
      if (this.tool !== TOOL_PEN) return;
      if (e.evt && e.evt.button === 2) return;
      e.evt?.preventDefault?.();
      const pos = this.stage.getRelativePointerPosition();
      if (!pos) return;
      this.isDrawing = true;
      this.freehandCount += 1;
      const line = new Line({
        stroke: "#111111",
        strokeWidth: 2.5,
        lineCap: "round",
        lineJoin: "round",
        tension: 0.35,
        points: [pos.x, pos.y],
        draggable: false,
        listening: false,
        name: `Stroke ${this.freehandCount}`,
        toolType: "freehand",
      });
      this.currentLine = line;
      this.canvasManager.setupShapeEvents(line, "Line");
      this.canvasManager.addShape(line);
      window.eventBus.emit("shapeAdded");
      window.addEventListener("mouseup", this._boundPenUp);
      window.addEventListener("touchend", this._boundPenUp);
    });

    this.stage.on("mousemove touchmove", () => {
      if (!this.isDrawing || !this.currentLine || this.tool !== TOOL_PEN)
        return;
      const pos = this.stage.getRelativePointerPosition();
      if (!pos) return;
      const pts = this.currentLine.points().slice();
      pts.push(pos.x, pos.y);
      this.currentLine.points(pts);
      this.canvasManager.mainLayer.batchDraw();
    });

    this.stage.on("mouseup touchend", () => {
      if (this.tool === TOOL_PEN) this._finishPenStroke();
    });
  }

  _finishPenStroke() {
    window.removeEventListener("mouseup", this._boundPenUp);
    window.removeEventListener("touchend", this._boundPenUp);
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.currentLine = null;
    this.canvasManager.mainLayer.batchDraw();
  }

  _bindStickyPlacement() {
    this.stage.on("click", (e) => {
      if (this.tool !== TOOL_NOTE) return;
      if (e.target !== this.stage) return;
      const pos = this.stage.getRelativePointerPosition();
      if (!pos) return;
      this._createStickyNote(pos.x, pos.y);
    });
  }

  _createStickyNote(centerX, centerY) {
    const w = 200;
    const h = 140;
    this.stickyCount += 1;
    const name = `Note ${this.stickyCount}`;
    const group = new Group({
      x: centerX - w / 2,
      y: centerY - h / 2,
      draggable: true,
      listening: true,
      name,
      toolType: "sticky",
    });

    const rect = new Rect({
      width: w,
      height: h,
      fill: "#fff9c4",
      stroke: "#e6d98c",
      strokeWidth: 1,
      cornerRadius: 6,
      shadowBlur: 6,
      shadowColor: "rgba(0,0,0,0.12)",
      shadowOffsetY: 2,
      listening: true,
    });

    const text = new Text({
      x: 10,
      y: 10,
      width: w - 20,
      text: "Double click to edit",
      fontSize: 14,
      fontFamily: "Poppins",
      fill: "#333333",
      listening: true,
    });

    group.add(rect);
    group.add(text);

    this.textManager.setupStickyNote(group);
    this.canvasManager.setupShapeEvents(group, "StickyNote");
    this.canvasManager.addShape(group);
    this.registerNewShape(group);
    window.eventBus.emit("shapeSelected", group);
    window.eventBus.emit("shapeAdded");
  }
}

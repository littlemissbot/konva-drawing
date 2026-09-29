import { Line } from "konva/lib/shapes/Line";
import { Group } from "konva/lib/Group";
import { Rect } from "konva/lib/shapes/Rect";
import { Text } from "konva/lib/shapes/Text";
import { createId } from "../core/Document.js";
import { normalizeRect, shapesInMarquee } from "./Marquee.js";

const TOOL_CURSOR = "cursor";
const TOOL_PEN = "pen";
const TOOL_NOTE = "note";

// Below this many px of drag, a mousedown-move-up on empty canvas is
// still treated as a plain click (deselect), not a marquee - guards
// against ordinary mouse jitter starting a marquee nobody meant to draw.
const MARQUEE_MIN_DRAG = 4;

export class ToolManager {
  constructor({ stage, canvasManager, textManager, guidesLayer }) {
    this.stage = stage;
    this.canvasManager = canvasManager;
    this.textManager = textManager;
    this.guidesLayer = guidesLayer;
    this.tool = TOOL_CURSOR;
    this.isDrawing = false;
    this.currentLine = null;
    this.freehandCount = 0;
    this.stickyCount = 0;
    this._marqueeStart = null;
    this._marqueeRect = null;
    this._marqueeAdditive = false;
    // Set right after a real (past-threshold) marquee drag applies its
    // selection, consumed by CanvasManager's own empty-canvas "click"
    // handler on the very next click - see _bindMarqueeSelect's own
    // comment for why that's needed at all.
    this._suppressNextEmptyClick = false;
    this._boundPenUp = this._finishPenStroke.bind(this);
    this._bindPenDrawing();
    this._bindStickyPlacement();
    this._bindMarqueeSelect();
    this.setTool(TOOL_CURSOR);
  }

  /** CanvasManager's stage "click" handler calls this before deselecting
   * on an empty-canvas click, so it can skip that deselect exactly once
   * right after a real marquee drag already set the selection - see
   * _bindMarqueeSelect's own comment for why a plain "click" still fires
   * (and would otherwise immediately wipe out what the marquee just
   * selected) even after a real drag on the stage background. */
  consumeSuppressedClick() {
    if (this._suppressNextEmptyClick) {
      this._suppressNextEmptyClick = false;
      return true;
    }
    return false;
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
      // deselectShape() itself keeps the transformer in sync (docs/
      // TASKS.md P2-1's CanvasManager._syncTransformer), so nothing
      // here needs its own reference to the transformer any more.
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
    this.canvasManager.shapes.forEach((shape) =>
      this._setShapePointerMode(shape, cursorLike, penMode)
    );
  }

  registerNewShape(shape) {
    const cursorLike = this.tool === TOOL_CURSOR;
    const penMode = this.tool === TOOL_PEN;
    this._setShapePointerMode(shape, cursorLike, penMode);
  }

  // A real group's (docs/TASKS.md P2-6) own children are never in
  // canvasManager.shapes (only the group itself is), so the loops above
  // would otherwise never reach them - meaning they'd keep listening for
  // clicks even in pen mode, unlike every other shape. draggable is
  // deliberately NOT touched here: group children stay non-draggable
  // regardless of tool (CanvasManager.groupSelection's own choice - v1
  // has no way to drag one out of its group), only their listening
  // state needs to track the tool the same way top-level shapes' does.
  _setShapePointerMode(shape, cursorLike, penMode) {
    shape.draggable(cursorLike);
    shape.listening(!penMode);
    if (
      shape.getClassName() === "Group" &&
      shape.getAttr("toolType") === "group"
    ) {
      shape.getChildren().forEach((child) => child.listening(!penMode));
    }
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
        id: createId(),
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

  // Rubber-band select (docs/TASKS.md P2-2): click-drag on empty canvas
  // in the select tool draws a marquee, selecting every shape it
  // touches (Marquee.js's "intersect" mode - see its own comment on why
  // there's no UI yet for the "fully enclosed only" mode it already
  // supports). Shift held during the drag unions the matched shapes
  // into whatever was already selected, the same as shift-click does
  // for one shape at a time (CanvasManager.selectShapes' own additive
  // option).
  _bindMarqueeSelect() {
    this.stage.on("mousedown touchstart", (e) => {
      if (this.tool !== TOOL_CURSOR) return;
      if (e.target !== this.stage) return; // only an empty-canvas drag
      if (e.evt && e.evt.button === 2) return; // ignore right-click
      const pos = this.stage.getRelativePointerPosition();
      if (!pos) return;
      this._marqueeStart = pos;
      this._marqueeAdditive = !!e.evt?.shiftKey;
    });

    this.stage.on("mousemove touchmove", () => {
      if (!this._marqueeStart) return;
      const pos = this.stage.getRelativePointerPosition();
      if (!pos) return;
      const rect = normalizeRect(this._marqueeStart, pos);
      if (!this._marqueeRect) {
        // Don't actually show anything until past the jitter threshold
        // - a plain click that happens to move a pixel or two shouldn't
        // flash a marquee rectangle onto the screen.
        if (Math.max(rect.width, rect.height) < MARQUEE_MIN_DRAG) return;
        this._marqueeRect = new Rect({
          ...rect,
          fill: "rgba(37, 99, 235, 0.08)",
          stroke: "#2563eb",
          strokeWidth: 1,
          dash: [4, 4],
          listening: false,
        });
        this.guidesLayer.add(this._marqueeRect);
        // Set here, not in the "mouseup" handler below where it would
        // read naturally - verified empirically (a real Playwright
        // drag, not assumed from Konva's docs) that for a background
        // release Konva's Stage fires its own synthetic "click" from
        // within its native mouseup handling *before* invoking
        // listeners registered for Konva's own "mouseup" event, the
        // reverse of what a native browser mouseup-then-click pair
        // would suggest. Setting the flag this early, the moment the
        // drag is confirmed to be a real marquee rather than jitter,
        // means it's already true by the time that click fires,
        // whichever order Konva ends up calling things in.
        this._suppressNextEmptyClick = true;
      } else {
        this._marqueeRect.setAttrs(rect);
      }
      this.guidesLayer.batchDraw();
    });

    this.stage.on("mouseup touchend", () => {
      if (!this._marqueeStart) return;
      this._marqueeStart = null;
      if (!this._marqueeRect) return; // never passed the drag threshold

      const marqueeBox = {
        x: this._marqueeRect.x(),
        y: this._marqueeRect.y(),
        width: this._marqueeRect.width(),
        height: this._marqueeRect.height(),
      };
      this._marqueeRect.destroy();
      this._marqueeRect = null;
      this.guidesLayer.batchDraw();

      const entries = this.canvasManager.shapes.map((shape) => ({
        shape,
        box: shape.getClientRect({ relativeTo: this.stage }),
      }));
      const matched = shapesInMarquee(marqueeBox, entries);
      this.canvasManager.selectShapes(matched, {
        additive: this._marqueeAdditive,
      });
      this._marqueeAdditive = false;
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
      id: createId(),
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

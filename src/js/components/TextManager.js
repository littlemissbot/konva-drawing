import { Text } from "konva/lib/shapes/Text";

export class TextManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.activeTextarea = null;
    this.textCount = 0;
  }

  getUniqueName() {
    this.textCount += 1;
    return `Text ${this.textCount}`;
  }

  createText() {
    const name = this.getUniqueName();
    const text = new Text({
      x: this.canvasManager.stage.width() / 2,
      y: this.canvasManager.stage.height() / 2,
      text: "Double click to edit",
      fontSize: 16,
      fontFamily: "Poppins",
      fill: "#000000",
      draggable: true,
      width: 200,
      padding: 5,
      name,
    });

    this.setupTextEvents(text);
    this.canvasManager.addShape(text);
    window.eventBus.emit("shapeAdded");
  }

  startEditing(text) {
    if (this.activeTextarea) {
      this.removeTextarea();
    }

    // text.absolutePosition() already composes the Stage's own x/y/scale
    // (Konva has no separate "pan" transform: pan and zoom both live on
    // the Stage node itself, and Node.getAbsoluteTransform() walks every
    // ancestor including the Stage), so this position is correct at any
    // zoom level and after any pan without further adjustment. What was
    // NOT accounted for below is that text.width()/height()/fontSize()
    // are local (unscaled) values: the textarea's CSS box must be scaled
    // up or down by the node's current absolute scale to visually match
    // the canvas glyphs, and rotated to match a rotated text node (the
    // transformer allows rotating Text). getAbsoluteScale().x/.y can
    // differ if a rotated ancestor has non-uniform scale, but for this
    // app's shapes (uniform-scale groups, unrotated stage) x and y are
    // equal; .x is used throughout as the single scale factor.
    const textPosition = text.absolutePosition();
    const stageBox = this.canvasManager.stage
      .container()
      .getBoundingClientRect();
    const areaPosition = {
      x: stageBox.left + textPosition.x,
      y: stageBox.top + textPosition.y,
    };
    const scale = text.getAbsoluteScale().x;
    const rotation = text.getAbsoluteRotation();

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    this.activeTextarea = textarea;

    textarea.value = text.text();
    textarea.style.position = "absolute";
    textarea.style.top = areaPosition.y + "px";
    textarea.style.left = areaPosition.x + "px";
    textarea.style.width = (text.width() - text.padding() * 2) * scale + "px";
    textarea.style.height =
      (text.height() - text.padding() * 2) * 1.2 * scale + "px";
    textarea.style.fontSize = text.fontSize() * scale + "px";
    textarea.style.border = "none";
    textarea.style.padding = "4px";
    textarea.style.margin = "0px";
    textarea.style.overflow = "auto";
    textarea.style.background = "none";
    textarea.style.outline = "none";
    textarea.style.resize = "none";
    textarea.style.lineHeight = text.lineHeight();
    textarea.style.fontFamily = text.fontFamily();
    // Rotation happens around the node's untransformed top-left corner
    // (Text defaults to offsetX/offsetY 0), matching transform-origin
    // "left top" applied to a CSS-absolute box anchored at that corner.
    textarea.style.transformOrigin = "left top";
    textarea.style.transform = rotation ? `rotate(${rotation}deg)` : "";
    textarea.style.textAlign = text.align();
    textarea.style.color = text.fill();
    textarea.style.zIndex = "1000";

    const removeTextarea = () => {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea);
      }
      window.removeEventListener("click", handleOutsideClick);
      text.show();
      this.canvasManager.mainLayer.draw();
      this.activeTextarea = null;
      window.eventBus.emit("textEditCommitted");
    };

    const handleOutsideClick = (e) => {
      if (e.target !== textarea && e.target.tagName !== "CANVAS") {
        text.text(textarea.value);
        removeTextarea();
      }
    };

    textarea.addEventListener("keydown", (e) => {
      if (e.keyCode === 13 && !e.shiftKey) {
        e.preventDefault();
        text.text(textarea.value);
        removeTextarea();
      }
      if (e.keyCode === 27) {
        e.preventDefault();
        removeTextarea();
      }
    });

    // Re-applies the same scale-aware sizing as above. text.width()/
    // fontSize() don't change from typing, so this is mainly a guard
    // against the stage being zoomed (Ctrl/Cmd +/-/0 and wheel-zoom are
    // not disabled while a textarea has focus) while editing is open;
    // it was previously dividing by scale, which is backwards and made
    // the box shrink as the user zoomed in.
    textarea.addEventListener("input", () => {
      const liveScale = text.getAbsoluteScale().x;
      textarea.style.width =
        (text.width() - text.padding() * 2) * liveScale + "px";
      textarea.style.height =
        (text.height() - text.padding() * 2) * 1.2 * liveScale + "px";
      textarea.style.fontSize = text.fontSize() * liveScale + "px";
    });

    setTimeout(() => {
      textarea.focus();
    });

    text.hide();
    this.canvasManager.mainLayer.draw();
    window.addEventListener("click", handleOutsideClick);
  }

  setupTextEvents(text) {
    text.on("click", () => {
      window.eventBus.emit("shapeSelected", text);
    });

    text.on("dblclick", () => {
      this.startEditing(text);
    });

    text.on("dragmove", () => {
      this.canvasManager.mainLayer.batchDraw();
    });
  }

  setupStickyNote(group) {
    const text = group.findOne("Text");
    if (!text) return;
    text.off(".stickyNote");
    text.on("click.stickyNote", (e) => {
      e.cancelBubble = true;
      window.eventBus.emit("shapeSelected", group);
    });
    text.on("dblclick.stickyNote", (e) => {
      e.cancelBubble = true;
      this.startEditing(text);
    });
    text.on("dragmove.stickyNote", () => {
      this.canvasManager.mainLayer.batchDraw();
    });
  }
}

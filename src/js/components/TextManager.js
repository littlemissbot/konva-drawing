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

    const textPosition = text.absolutePosition();
    const stageBox = this.canvasManager.stage
      .container()
      .getBoundingClientRect();
    const areaPosition = {
      x: stageBox.left + textPosition.x,
      y: stageBox.top + textPosition.y,
    };

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    this.activeTextarea = textarea;

    textarea.value = text.text();
    textarea.style.position = "absolute";
    textarea.style.top = areaPosition.y + "px";
    textarea.style.left = areaPosition.x + "px";
    textarea.style.width = text.width() - text.padding() * 2 + "px";
    textarea.style.height = (text.height() - text.padding() * 2) * 1.2 + "px";
    textarea.style.fontSize = text.fontSize() + "px";
    textarea.style.border = "none";
    textarea.style.padding = "4px";
    textarea.style.margin = "0px";
    textarea.style.overflow = "auto";
    textarea.style.background = "none";
    textarea.style.outline = "none";
    textarea.style.resize = "none";
    textarea.style.lineHeight = text.lineHeight();
    textarea.style.fontFamily = text.fontFamily();
    textarea.style.transformOrigin = "left top";
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

    textarea.addEventListener("input", () => {
      const scale = text.getAbsoluteScale().x;
      textarea.style.width = (text.width() - text.padding() * 2) / scale + "px";
      textarea.style.height =
        ((text.height() - text.padding() * 2) * 1.2) / scale + "px";
      textarea.style.fontSize = text.fontSize() / scale + "px";
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
}

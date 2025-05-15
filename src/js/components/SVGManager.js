import Konva from "konva";

export class SVGManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    // this.setupSVGButtons(); // Disabled until SVG panel is reintroduced
    this.svgCount = 0;
  }

  getUniqueName() {
    this.svgCount += 1;
    return `SVG ${this.svgCount}`;
  }

  // setupSVGButtons() {
  //   const svgsList = document.getElementById("svgsList");
  //   const svgs = [
  //     // ... SVG button definitions ...
  //   ];
  //   svgs.forEach((svg) => {
  //     const li = document.createElement("li");
  //     li.innerHTML = `<img src="assets/icons/${svg.icon}" alt="${svg.name}">`;
  //     li.onclick = svg.handler;
  //     svgsList.appendChild(li);
  //   });
  // }

  createSVG(svgFile) {
    const url = `assets/svgs/${svgFile}`;
    const name = this.getUniqueName();
    Konva.Image.fromURL(url, (image) => {
      image.setAttrs({
        x: this.canvasManager.stage.width() / 2,
        y: this.canvasManager.stage.height() / 2,
        width: 50,
        height: 50,
        draggable: true,
        name,
      });
      this.setupSVGEvents(image, svgFile);
      this.canvasManager.addShape(image);
    });
  }

  setupSVGEvents(image, name) {
    image.on("click", () => {
      window.eventBus.emit("shapeSelected", image);
    });

    image.on("mouseover", () => {
      this.canvasManager.updateTooltip(name, image.x(), image.y());
    });

    image.on("mouseout", () => {
      this.canvasManager.hideTooltip();
    });

    image.on("dragmove", () => {
      this.canvasManager.mainLayer.batchDraw();
    });
  }
}

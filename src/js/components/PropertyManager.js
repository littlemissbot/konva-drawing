export class PropertyManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    // this.updateForm(null); // Disabled until properties panel is reintroduced
  }

  updateForm(shape) {
    const form = document.getElementById("propertiesForm");
    const nameInput = form.querySelector("#itemName");
    const textContentInput = form.querySelector("#textContent");
    const backgroundColorInput = form.querySelector("#backgroundColor");
    const strokeColorInput = form.querySelector("#strokeColor");
    const strokeWidthInput = form.querySelector("#strokeWidth");
    const deleteBtn = document.getElementById("deleteBtn");
    let svgMsg = document.getElementById("svg-properties-msg");
    if (!svgMsg) {
      svgMsg = document.createElement("div");
      svgMsg.id = "svg-properties-msg";
      svgMsg.style.display = "none";
      svgMsg.style.padding = "1rem";
      svgMsg.style.color = "#888";
      svgMsg.style.textAlign = "center";
      svgMsg.textContent =
        "SVG images can be resized and rotated, but do not have editable properties.";
      form.parentNode.insertBefore(svgMsg, form);
    }

    if (shape && shape.getClassName && shape.getClassName() === "Image") {
      form.style.display = "none";
      svgMsg.style.display = "";
      return;
    } else {
      form.style.display = "";
      svgMsg.style.display = "none";
    }

    if (shape) {
      nameInput.value = shape.getAttr("name") || "";
      backgroundColorInput.value = shape.getAttr("fill") || "#ffffff";
      strokeColorInput.value = shape.getAttr("stroke") || "#000000";
      strokeWidthInput.value = shape.getAttr("strokeWidth") || 2;

      // Show/hide text content input based on shape type
      if (shape.getClassName() === "Text") {
        textContentInput.parentNode.style.display = "";
        textContentInput.value = shape.text() || "";
      } else {
        textContentInput.parentNode.style.display = "none";
      }

      // Enable form controls
      nameInput.disabled = false;
      backgroundColorInput.disabled = false;
      strokeColorInput.disabled = false;
      strokeWidthInput.disabled = false;
      deleteBtn.disabled = false;
      if (shape.getClassName() === "Text") {
        textContentInput.disabled = false;
      }
    } else {
      // Disable form controls
      nameInput.value = "";
      backgroundColorInput.value = "#ffffff";
      strokeColorInput.value = "#000000";
      strokeWidthInput.value = 2;
      textContentInput.value = "";

      nameInput.disabled = true;
      backgroundColorInput.disabled = true;
      strokeColorInput.disabled = true;
      strokeWidthInput.disabled = true;
      textContentInput.disabled = true;
      deleteBtn.disabled = true;
    }
  }
}

import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { ShapeManager } from "./components/ShapeManager.js";
import { PropertyManager } from "./components/PropertyManager.js";
import { SVGManager } from "./components/SVGManager.js";
import { CanvasManager } from "./components/CanvasManager.js";
import { TextManager } from "./components/TextManager.js";
import { EventBus } from "./utils/EventBus.js";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import Konva from "konva";

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Wait for DOM to be fully loaded
window.addEventListener("DOMContentLoaded", () => {
  // Initialize event bus for communication between components
  window.eventBus = new EventBus();

  // Initialize the canvas
  const container = document.getElementById("container");
  const stage = new Stage({
    container: "container",
    width: container.offsetWidth,
    height: container.offsetHeight,
  });

  // Create layers
  const mainLayer = new Layer();
  const tooltipLayer = new Layer();
  stage.add(mainLayer);
  stage.add(tooltipLayer);

  // Add transformer for resize/rotate
  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    enabledAnchors: [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "middle-left",
      "middle-right",
      "top-center",
      "bottom-center",
    ],
    boundBoxFunc: (oldBox, newBox) => {
      // limit resize
      if (newBox.width < 10 || newBox.height < 10) {
        return oldBox;
      }
      return newBox;
    },
    ignoreStroke: true,
    padding: 5,
  });

  // Add transformer events
  transformer.on("transformstart", function (e) {
    const node = e.target;
    if (node.getClassName() === "Text") {
      node.isEditing = true;
    }
  });

  transformer.on("transform", function (e) {
    const node = e.target;
    if (node.getClassName() === "Text") {
      const scale = node.getAbsoluteScale();
      const newWidth = node.width() * scale.x;
      const newHeight = node.height() * scale.y;

      // Keep the text within reasonable bounds
      if (newWidth > 10 && newHeight > 10) {
        node.width(newWidth);
        node.height(newHeight);
        node.scale({ x: 1, y: 1 });
      }
    }
  });

  transformer.on("transformend", function (e) {
    const node = e.target;
    if (node.getClassName() === "Text") {
      node.isEditing = false;
      // Ensure the text stays within the stage bounds
      const stageBox = stage.getContainer().getBoundingClientRect();
      const nodeBox = node.getClientRect();

      if (nodeBox.x < 0) node.x(0);
      if (nodeBox.y < 0) node.y(0);
      if (nodeBox.x + nodeBox.width > stageBox.width) {
        node.x(stageBox.width - nodeBox.width);
      }
      if (nodeBox.y + nodeBox.height > stageBox.height) {
        node.y(stageBox.height - nodeBox.height);
      }

      mainLayer.batchDraw();
    }
  });

  mainLayer.add(transformer);

  // Initialize managers
  const canvasManager = new CanvasManager(stage, mainLayer, tooltipLayer);
  const origSelectShape = canvasManager.selectShape.bind(canvasManager);
  const origDeselectShape = canvasManager.deselectShape.bind(canvasManager);
  canvasManager.selectShape = function (shape) {
    origSelectShape(shape);
    // Don't attach transformer to text shapes when they are being edited
    if (!(shape.getClassName() === "Text" && shape.isEditing)) {
      transformer.nodes([shape]);
      // For text shapes, set the transformer to use the shape's current size
      if (shape.getClassName() === "Text") {
        const box = shape.getClientRect();
        transformer.setAttrs({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }
    }
  };
  canvasManager.deselectShape = function () {
    origDeselectShape();
    transformer.nodes([]);
  };

  const shapeManager = new ShapeManager(canvasManager);
  const propertyManager = new PropertyManager(canvasManager);
  const svgManager = new SVGManager(canvasManager);
  const textManager = new TextManager(canvasManager);
  canvasManager.setTextManager(textManager);

  // Make managers globally available for menu logic
  window.shapeManager = shapeManager;
  window.textManager = textManager;
  window.canvasManager = canvasManager;

  // Initialize UI components
  // Removed save/load button event listeners as only auto-save is needed

  // --- Auto-save logic ---
  let lastSavedData = null;
  let savePending = false;
  const saveStatus = document.querySelector(".save-status");
  function showSaveStatus(msg = "All changes saved") {
    if (saveStatus) {
      const saveIcon = saveStatus.querySelector('img[alt="Saved"]');
      const savingIcon = saveStatus.querySelector('img[alt="Saving"]');
      const clearedIcon = saveStatus.querySelector('img[alt="Cleared"]');
      const statusText = saveStatus.querySelector(".save-status-text");

      statusText.textContent = msg;

      // Hide all icons first
      saveIcon.style.display = "none";
      savingIcon.style.display = "none";
      clearedIcon.style.display = "none";

      // Show appropriate icon based on message
      if (msg === "Saving changes...") {
        savingIcon.style.display = "block";
      } else if (msg === "Canvas cleared") {
        clearedIcon.style.display = "block";
      } else {
        saveIcon.style.display = "block";
      }

      saveStatus.style.opacity = "1";
      saveStatus.style.transition = "opacity 0.3s";
      setTimeout(() => {
        saveStatus.style.opacity = "1";
      }, 100);
      setTimeout(() => {
        saveStatus.style.opacity = "0.7";
      }, 2000);
    }
  }

  function getCurrentData() {
    return JSON.stringify({
      shapes: canvasManager.shapes.map((shape) => {
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
      }),
    });
  }

  const debouncedAutoSave = debounce(() => {
    const data = getCurrentData();
    if (data !== lastSavedData) {
      try {
        localStorage.setItem("canvasData", data);
        lastSavedData = data;
        showSaveStatus("All changes saved");
        savePending = false;
      } catch (e) {
        console.error("Failed to save canvas data:", e);
        showSaveStatus("Failed to save changes");
      }
    }
  }, 2000);

  function markDirty() {
    if (!savePending) {
      savePending = true;
      showSaveStatus("Saving changes...");
    }
    debouncedAutoSave();
  }

  // Listen for changes to trigger auto-save
  [stage, mainLayer].forEach((obj) => {
    obj.on("dragend", markDirty);
    obj.on("transformend", markDirty);
    obj.on("mouseup", markDirty);
    obj.on("change", markDirty);
  });

  // Listen for shape events
  window.eventBus.on("shapeSelected", markDirty);
  window.eventBus.on("shapeDeselected", markDirty);
  window.eventBus.on("shapeAdded", markDirty);
  window.eventBus.on("shapeRemoved", markDirty);

  // Listen for property changes
  const propertiesForm = document.getElementById("propertiesForm");
  if (propertiesForm) {
    propertiesForm.addEventListener("change", markDirty);
    propertiesForm.addEventListener("input", markDirty);
  }

  // Periodic save every 10 seconds
  setInterval(() => {
    if (savePending) {
      debouncedAutoSave();
    }
  }, 10000);

  // Auto-load on page load
  function autoLoad() {
    const data = localStorage.getItem("canvasData");
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.shapes) {
          canvasManager.clearCanvas();
          canvasManager.reconstructShapes(parsed.shapes);
          mainLayer.batchDraw();
          lastSavedData = data;
          showSaveStatus("Canvas loaded");
        }
      } catch (e) {
        showSaveStatus("Failed to load canvas");
      }
    }
    // After loading, show/hide the add object card
    const card = document.getElementById("addFirstObjectCard");
    if (
      window.canvasManager &&
      window.canvasManager.shapes &&
      window.canvasManager.shapes.length > 0
    ) {
      card.style.display = "none";
    } else {
      card.style.display = "flex";
    }
  }

  // Add beforeunload event listener to warn about unsaved changes
  window.addEventListener("beforeunload", (e) => {
    if (savePending) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Call autoLoad after a short delay to ensure all components are initialized
  setTimeout(autoLoad, 100);

  // Clear Canvas button
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to clear the canvas? This cannot be undone."
      )
    ) {
      canvasManager.clearCanvas();
      localStorage.removeItem("canvasData");
      lastSavedData = null;
      showSaveStatus("Canvas cleared");
    }
  });

  // Handle window resize
  window.addEventListener("resize", () => {
    stage.width(container.offsetWidth);
    stage.height(container.offsetHeight);
    stage.batchDraw();
  });

  // --- Add First Object Card Logic ---
  function updateAddFirstObjectCard() {
    const card = document.getElementById("addFirstObjectCard");
    // Assume canvasManager.shapes is an array of shapes on the canvas
    if (
      window.canvasManager &&
      window.canvasManager.shapes &&
      window.canvasManager.shapes.length > 0
    ) {
      card.style.display = "none";
    } else {
      card.style.display = "flex";
    }
  }

  // Close card button
  const closeAddObjectCard = document.getElementById("closeAddObjectCard");
  if (closeAddObjectCard) {
    closeAddObjectCard.addEventListener("click", () => {
      document.getElementById("addFirstObjectCard").style.display = "none";
    });
  }

  // Listen for shape add/remove events to update card
  if (window.eventBus) {
    window.eventBus.on("shapeAdded", updateAddFirstObjectCard);
    window.eventBus.on("shapeRemoved", updateAddFirstObjectCard);
  }
  // Also call on load
  window.addEventListener("DOMContentLoaded", () => {
    // Try to load canvas data from localStorage
    let hasShapes = false;
    const data = localStorage.getItem("canvasData");
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.shapes && parsed.shapes.length > 0) {
          hasShapes = true;
        }
      } catch (e) {}
    }
    if (hasShapes) {
      document.getElementById("addFirstObjectCard").style.display = "none";
    } else {
      document.getElementById("addFirstObjectCard").style.display = "flex";
    }
  });

  // --- Zoom Controls Logic ---
  let zoomLevel = 1;
  const zoomPercentage = document.getElementById("zoomPercentage");
  const zoomInBtn = document.getElementById("zoomIn");
  const zoomOutBtn = document.getElementById("zoomOut");
  const zoomResetBtn = document.getElementById("zoomReset");
  const zoomFitBtn = document.getElementById("zoomFit");

  function updateZoomDisplay() {
    zoomPercentage.textContent = Math.round(zoomLevel * 100) + "%";
  }

  function getMousePosition() {
    return (
      stage.getPointerPosition() || {
        x: stage.width() / 2,
        y: stage.height() / 2,
      }
    );
  }

  function getRelativePoint(point) {
    return {
      x: (point.x - stage.x()) / stage.scaleX(),
      y: (point.y - stage.y()) / stage.scaleY(),
    };
  }

  function updateStagePosition(scale) {
    const mousePos = getMousePosition();
    const relativePoint = getRelativePoint(mousePos);

    // Calculate the new position to keep the point under the mouse
    const newPos = {
      x: mousePos.x - relativePoint.x * scale,
      y: mousePos.y - relativePoint.y * scale,
    };

    // Apply the new scale and position
    stage.scale({ x: scale, y: scale });
    stage.position(newPos);
    stage.batchDraw();
  }

  function zoomIn() {
    const newScale = Math.min(zoomLevel + 0.1, 2);
    if (newScale !== zoomLevel) {
      zoomLevel = newScale;
      updateStagePosition(newScale);
      updateZoomDisplay();
    }
  }

  function zoomOut() {
    const newScale = Math.max(zoomLevel - 0.1, 0.2);
    if (newScale !== zoomLevel) {
      zoomLevel = newScale;
      updateStagePosition(newScale);
      updateZoomDisplay();
    }
  }

  function resetZoom() {
    if (zoomLevel !== 1) {
      const mousePos = getMousePosition();
      const relativePoint = getRelativePoint(mousePos);

      zoomLevel = 1;

      const newPos = {
        x: mousePos.x - relativePoint.x,
        y: mousePos.y - relativePoint.y,
      };

      stage.scale({ x: 1, y: 1 });
      stage.position(newPos);
      stage.batchDraw();
      updateZoomDisplay();
    }
  }

  function zoomToFit() {
    if (canvasManager.shapes.length === 0) {
      resetZoom();
      return;
    }

    // Reset stage position and scale first
    stage.position({ x: 0, y: 0 });
    stage.scale({ x: 1, y: 1 });
    stage.batchDraw();

    // Calculate the bounding box of all shapes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    canvasManager.shapes.forEach((shape) => {
      const box = shape.getClientRect();
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    });

    // Add some padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Calculate the scale needed to fit the content
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const scaleX = stage.width() / contentWidth;
    const scaleY = stage.height() / contentHeight;
    const newScale = Math.min(scaleX, scaleY, 2); // Limit max zoom to 200%

    if (newScale !== zoomLevel) {
      zoomLevel = newScale;

      // Calculate the center point of the content
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Calculate the new position to center the content
      const newPos = {
        x: (stage.width() - contentWidth * newScale) / 2 - minX * newScale,
        y: (stage.height() - contentHeight * newScale) / 2 - minY * newScale,
      };

      // Apply the transformations
      stage.scale({ x: newScale, y: newScale });
      stage.position(newPos);
      stage.batchDraw();
      updateZoomDisplay();
    }
  }

  // Mouse wheel zoom
  stage.on("wheel", (e) => {
    e.evt.preventDefault();
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.max(0.2, Math.min(2, zoomLevel + direction * 0.1));
    if (newScale !== zoomLevel) {
      zoomLevel = newScale;
      updateStagePosition(newScale);
      updateZoomDisplay();
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "=") {
      e.preventDefault();
      zoomIn();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      zoomOut();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      resetZoom();
    }
  });

  // Button event listeners
  if (zoomInBtn && zoomOutBtn) {
    zoomInBtn.addEventListener("click", zoomIn);
    zoomOutBtn.addEventListener("click", zoomOut);
  }

  if (zoomResetBtn) {
    zoomResetBtn.addEventListener("click", resetZoom);
  }

  if (zoomFitBtn) {
    zoomFitBtn.addEventListener("click", zoomToFit);
  }

  // Initialize stage position and scale
  stage.position({ x: 0, y: 0 });
  stage.scale({ x: 1, y: 1 });
  updateZoomDisplay();

  // --- Floating Shapes Menu Logic ---
  const shapesToolBtn = document.getElementById("shapesTool");
  const floatingShapesMenu = document.getElementById("floatingShapesMenu");

  function showShapesMenu() {
    floatingShapesMenu.style.display = "flex";
  }
  function hideShapesMenu() {
    floatingShapesMenu.style.display = "none";
  }

  if (shapesToolBtn && floatingShapesMenu) {
    shapesToolBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (floatingShapesMenu.style.display === "flex") {
        hideShapesMenu();
      } else {
        showShapesMenu();
      }
    });
    // Hide menu when clicking outside
    document.addEventListener("mousedown", (e) => {
      if (
        !floatingShapesMenu.contains(e.target) &&
        e.target !== shapesToolBtn
      ) {
        hideShapesMenu();
      }
    });
  }

  // Add shape/text to canvas on menu button click
  const shapeBtnMap = [
    { id: "addSquare", method: "createSquare" },
    { id: "addRectangle", method: "createRectangle" },
    { id: "addCircle", method: "createCircle" },
    { id: "addTriangle", method: "createTriangle" },
    { id: "addLine", method: "createLine" },
    { id: "addArrow", method: "createArrow" },
  ];

  shapeBtnMap.forEach(({ id, method }) => {
    const btn = document.getElementById(id);
    if (
      btn &&
      window.shapeManager &&
      typeof window.shapeManager[method] === "function"
    ) {
      btn.addEventListener("click", () => {
        window.shapeManager[method]();
        hideShapesMenu();
      });
    }
  });

  // Add text to canvas from main toolbar
  const textToolBtn = document.getElementById("textTool");
  if (
    textToolBtn &&
    window.textManager &&
    typeof window.textManager.createText === "function"
  ) {
    textToolBtn.addEventListener("click", () => {
      window.textManager.createText();
    });
  }

  // --- Properties Panel Logic ---
  const propertiesPanel = document.getElementById("propertiesPanel");
  const nameInput = document.getElementById("itemName");
  const backgroundColorInput = document.getElementById("backgroundColor");
  const strokeColorInput = document.getElementById("strokeColor");
  const strokeWidthInput = document.getElementById("strokeWidth");
  const deleteBtn = document.getElementById("deleteBtn");

  function updatePropertiesPanel(shape) {
    if (!shape) {
      propertiesPanel.style.display = "none";
      return;
    }
    propertiesPanel.style.display = "flex";
    nameInput.value = shape.getAttr("name") || "";
    backgroundColorInput.value = shape.getAttr("fill") || "#ffffff";
    strokeColorInput.value = shape.getAttr("stroke") || "#000000";
    strokeWidthInput.value = shape.getAttr("strokeWidth") || 2;
  }

  window.eventBus.on("shapeSelected", (shape) => {
    updatePropertiesPanel(shape);
  });
  window.eventBus.on("shapeDeselected", () => {
    updatePropertiesPanel(null);
  });

  if (propertiesForm) {
    nameInput.addEventListener("input", () => {
      if (window.canvasManager.selectedShape) {
        window.canvasManager.selectedShape.setAttr("name", nameInput.value);
        window.canvasManager.mainLayer.batchDraw();
      }
    });
    backgroundColorInput.addEventListener("input", () => {
      if (window.canvasManager.selectedShape) {
        window.canvasManager.selectedShape.setAttr(
          "fill",
          backgroundColorInput.value
        );
        window.canvasManager.mainLayer.batchDraw();
      }
    });
    strokeColorInput.addEventListener("input", () => {
      if (window.canvasManager.selectedShape) {
        window.canvasManager.selectedShape.setAttr(
          "stroke",
          strokeColorInput.value
        );
        window.canvasManager.mainLayer.batchDraw();
      }
    });
    strokeWidthInput.addEventListener("input", () => {
      if (window.canvasManager.selectedShape) {
        window.canvasManager.selectedShape.setAttr(
          "strokeWidth",
          parseInt(strokeWidthInput.value)
        );
        window.canvasManager.mainLayer.batchDraw();
      }
    });
    deleteBtn.addEventListener("click", () => {
      if (window.canvasManager.selectedShape) {
        window.canvasManager.removeShape(window.canvasManager.selectedShape);
        window.canvasManager.deselectShape();
        updatePropertiesPanel(null);
      }
    });
  }

  // Add a function to check and restore canvas data
  function checkAndRestoreCanvas() {
    const data = localStorage.getItem("canvasData");
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.shapes && parsed.shapes.length > 0) {
          // Clear existing canvas
          canvasManager.clearCanvas();
          // Reconstruct shapes from saved data
          canvasManager.reconstructShapes(parsed.shapes);
          mainLayer.batchDraw();
          showSaveStatus("Canvas restored");
          return true;
        }
      } catch (e) {
        console.error("Failed to restore canvas:", e);
      }
    }
    return false;
  }

  // Call the restore function
  if (!checkAndRestoreCanvas()) {
    showSaveStatus("No saved canvas found");
  }
});

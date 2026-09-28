import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { ShapeManager } from "./canvas/ShapeManager.js";
import { SVGManager } from "./canvas/SVGManager.js";
import { CanvasManager } from "./canvas/CanvasManager.js";
import { TextManager } from "./canvas/TextManager.js";
import { ToolManager } from "./canvas/ToolManager.js";
import { HistoryManager } from "./core/HistoryManager.js";
import { EventBus } from "./core/EventBus.js";
import { Persistence } from "./core/Persistence.js";
import { createEmptyDocument } from "./core/Document.js";
import { bindShortcuts } from "./ui/Shortcuts.js";
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
window.addEventListener("DOMContentLoaded", async () => {
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
  // PropertyManager is not instantiated: nothing in this app calls it
  // today (its updateForm() references a #textContent input this page
  // doesn't have, and the properties panel below is driven entirely by
  // this file's own inline updatePropertiesPanel() instead). See
  // src/js/ui/PropertyManager.js and docs/TASKS.md P3-5, which plans to
  // rebuild the properties panel as its single source of truth.
  const svgManager = new SVGManager(canvasManager);
  const textManager = new TextManager(canvasManager);
  canvasManager.setTextManager(textManager);

  const toolManager = new ToolManager({
    stage,
    canvasManager,
    textManager,
    transformer,
  });
  canvasManager.setToolManager(toolManager);

  // Make managers globally available for menu logic
  window.shapeManager = shapeManager;
  window.textManager = textManager;
  window.canvasManager = canvasManager;
  window.toolManager = toolManager;
  // svgManager.createSVG() has no UI entry point yet: the icon panel is
  // disabled pending docs/TASKS.md P7-1. Exposed here for consistency
  // with the other managers and so it is reachable ahead of that work.
  window.svgManager = svgManager;

  document.getElementById("selectTool")?.addEventListener("click", () => {
    toolManager.setTool("cursor");
  });
  document.getElementById("pencilTool")?.addEventListener("click", () => {
    toolManager.setTool("pen");
  });
  document.getElementById("stickyTool")?.addEventListener("click", () => {
    toolManager.setTool("note");
  });

  // Initialize UI components
  // Removed save/load button event listeners as only auto-save is needed

  // --- Auto-save logic ---
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

  // The in-memory snapshot format HistoryManager's undo/redo uses is
  // deliberately unchanged from before Document.js existed (see
  // docs/TASKS.md Phase 1's scope decision: the command-based History
  // rewrite is deferred, not this) - it only ever needs a comparable,
  // restorable string, not full document metadata or zIndex ordering
  // (shape array order already carries that).
  function getCurrentData() {
    return JSON.stringify({
      shapes: canvasManager.shapes.map((shape) =>
        canvasManager.toStorageShape(shape)
      ),
    });
  }

  function applyCanvasSnapshot(json) {
    const parsed = JSON.parse(json);
    canvasManager.clearCanvas();
    canvasManager.reconstructShapes(parsed.shapes || []);
    canvasManager.toolManager?.refreshInteractivity();
    canvasManager.deselectShape();
    transformer.nodes([]);
    mainLayer.batchDraw();
    updateAddFirstObjectCard();
    updatePropertiesPanel(null);
    // An undo/redo is itself a change worth persisting, same as any
    // edit - scheduleSave, not saveNow, so rapid undo/redo presses
    // still debounce together instead of writing on every keystroke.
    persistence.scheduleSave(buildCurrentDocument());
  }

  const historyManager = new HistoryManager({
    getSnapshot: getCurrentData,
    applySnapshot: applyCanvasSnapshot,
    maxStates: 50,
  });
  window.historyManager = historyManager;

  const debouncedHistoryCommit = debounce(() => {
    historyManager.commit();
  }, 400);

  // The persistent (localStorage/IndexedDB) document, as opposed to
  // getCurrentData()'s lightweight undo/redo snapshot above. Starts as
  // a fresh empty document's metadata; loadSavedCanvas() below replaces
  // it with the loaded document's own id/name/createdAt if one exists,
  // so re-saving keeps the same document identity across a reload
  // rather than minting a new id on every save.
  let currentDocument = createEmptyDocument();

  function buildCurrentDocument() {
    return {
      ...currentDocument,
      updatedAt: Date.now(),
      objects: canvasManager.toDocumentObjects(),
    };
  }

  const persistence = new Persistence({
    debounceMs: 2000,
    maxWaitMs: 10000,
    onStatusChange: ({ state, backend, error }) => {
      if (state === "saving") {
        showSaveStatus("Saving changes...");
      } else if (state === "saved") {
        showSaveStatus(
          backend === "indexeddb"
            ? "All changes saved (backup storage)"
            : "All changes saved"
        );
      } else if (state === "failed") {
        console.error("FrameX: failed to save the document:", error);
        showSaveStatus("Failed to save changes");
      }
    },
  });

  function markDirty() {
    persistence.scheduleSave(buildCurrentDocument());
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

  window.eventBus.on("shapeAdded", () => {
    historyManager.commit();
  });
  window.eventBus.on("shapeRemoved", () => {
    historyManager.commit();
  });
  window.eventBus.on("shapeDragEnded", debouncedHistoryCommit);
  window.eventBus.on("textEditCommitted", debouncedHistoryCommit);

  transformer.on("transformend", () => {
    debouncedHistoryCommit();
  });

  // Listen for property changes
  const propertiesForm = document.getElementById("propertiesForm");
  if (propertiesForm) {
    propertiesForm.addEventListener("change", markDirty);
    propertiesForm.addEventListener("input", markDirty);
    propertiesForm.addEventListener("change", debouncedHistoryCommit);
    propertiesForm.addEventListener("input", debouncedHistoryCommit);
  }

  // Add beforeunload event listener to warn about unsaved changes
  window.addEventListener("beforeunload", (e) => {
    if (persistence.isSaving) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Clear Canvas button
  document.getElementById("clearBtn").addEventListener("click", async () => {
    if (
      confirm(
        "Clear the entire canvas? You can use Undo (Ctrl+Z) to restore this version."
      )
    ) {
      historyManager.commit();
      canvasManager.clearCanvas();
      await persistence.clear();
      historyManager.commit();
      showSaveStatus("Canvas cleared");
    }
  });

  document.getElementById("undoTool")?.addEventListener("click", () => {
    historyManager.undo();
  });
  document.getElementById("redoTool")?.addEventListener("click", () => {
    historyManager.redo();
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
  // The card's initial state (shown/hidden based on saved data) is set
  // once by loadSavedCanvas() near the end of this handler, not here:
  // this file's own top-level listener (line 23) IS the DOMContentLoaded
  // handler, so a second `window.addEventListener("DOMContentLoaded", …)`
  // nested inside it (as this used to be) registers after the event has
  // already fired and never runs. Registering it here duplicated that
  // dead logic a third time (see loadSavedCanvas and the removed
  // autoLoad) without ever executing.

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

  // All global keyboard shortcuts (undo/redo, zoom, delete, escape) live
  // in ui/Shortcuts.js, not inline here - see that file for behavior and
  // comments. updatePropertiesPanel is a hoisted function declaration
  // defined further down in this same scope; passing it here is safe
  // regardless of source order since this call only runs once the whole
  // DOMContentLoaded handler's declarations have all been hoisted.
  bindShortcuts({
    historyManager,
    canvasManager,
    toolManager,
    transformer,
    mainLayer,
    zoomIn,
    zoomOut,
    resetZoom,
    updatePropertiesPanel,
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
  // Arrow, Polyline, Curved Arrow, Rounded Square, Diamond, Speech Bubble
  // and Arrowed Box are Phase 3 work (docs/TASKS.md P3-2): their buttons
  // are hidden in canvas.html until ShapeManager implements them.
  const shapeBtnMap = [
    { id: "addSquare", method: "createSquare" },
    { id: "addRectangle", method: "createRectangle" },
    { id: "addCircle", method: "createCircle" },
    { id: "addTriangle", method: "createTriangle" },
    { id: "addStar", method: "createStar" },
    { id: "addLine", method: "createLine" },
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

  // Single entry point for loading a saved drawing on startup. This
  // replaces three previous, partially-redundant load paths that ran on
  // every page load (docs/TASKS.md P0-2): a synchronous
  // checkAndRestoreCanvas() call right here, a setTimeout(autoLoad, 100)
  // that unconditionally re-ran the same reconstruction ~100ms later on
  // top of whatever checkAndRestoreCanvas had already loaded, and a
  // nested `DOMContentLoaded` listener (dead code - this whole file is
  // already inside the outer DOMContentLoaded handler, so a second one
  // registered from within it fires too late to ever run) that
  // duplicated the card-visibility check a third time. Called once,
  // synchronously, at the end of this handler: every manager it touches
  // (canvasManager, historyManager, toolManager) is already constructed
  // by this point, so no artificial delay is needed.
  async function loadSavedCanvas() {
    try {
      const { document: loaded, migrated } = await persistence.load();
      if (loaded) {
        // Keep the loaded document's own id/name/createdAt so re-saving
        // preserves its identity instead of minting a new document on
        // every reload; a legitimately-saved empty canvas (every shape
        // deleted one by one, not via Clear Canvas) still counts as a
        // real restore, unlike the pre-Document.js version of this
        // function, which only treated a *non-empty* saved shapes array
        // as a restore - Document.js's schema is explicit that an empty
        // objects array is still a valid, real document.
        currentDocument = loaded;
        canvasManager.clearCanvas();
        canvasManager.loadDocumentObjects(loaded.objects);
        canvasManager.toolManager?.refreshInteractivity();
        mainLayer.batchDraw();
        if (migrated) {
          // Write the upgraded v2 format back immediately so a reload
          // before the next edit still finds it, rather than silently
          // re-migrating from the old format on every load until the
          // user happens to make a change. Before showing "Canvas
          // restored" below, not after: saveNow's own status callback
          // sets the same .save-status-text element to "All changes
          // saved", which would otherwise silently overwrite the more
          // informative "Canvas restored" message a moment later.
          await persistence.saveNow(buildCurrentDocument());
        }
        showSaveStatus("Canvas restored");
      } else {
        showSaveStatus("No saved canvas found");
      }
    } catch (e) {
      console.error("Failed to restore canvas:", e);
      showSaveStatus("Failed to load canvas");
    }
    historyManager.reset(getCurrentData());
    updateAddFirstObjectCard();
  }

  await loadSavedCanvas();
});

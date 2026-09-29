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
import {
  exportJsonBlob,
  suggestedFilename,
  readDocumentFile,
} from "./export/json.js";
import {
  gatherExportOptions,
  runExport,
  suggestedExportFilename,
} from "./ui/ExportDialog.js";
import { printCanvas } from "./ui/Print.js";
import { bindShortcuts } from "./ui/Shortcuts.js";
// The named import (not a bare `import "bootstrap/.../bootstrap.bundle.min.js"`
// side-effect import) matters: that bundle is a UMD build whose global-
// scope fallback resolves to `undefined` in Vite's ESM output, so
// nothing ever attaches a usable `window.bootstrap` - the export
// dialog's Ctrl+E path (which calls Modal.show()/hide() programmatically,
// not just via data-bs-toggle/dismiss attributes) silently no-op'd
// until this was caught by e2e/export-dialog.spec.js. Modal itself
// doesn't need Popper (only Dropdown/Tooltip/Popover do), so importing
// just Modal from bootstrap's real ESM build needs no other setup.
import { Modal } from "bootstrap";
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

  // Create layers. guidesLayer is transient UI drawn over the shapes
  // but not part of the document itself - today just the marquee-select
  // rectangle (docs/TASKS.md P2-2); a natural home for smart guides
  // later (PRD NAV-4) without needing a new layer then too. Stacked
  // above mainLayer (so the marquee is visible while dragging over
  // shapes) and below tooltipLayer (tooltips should still win if they
  // ever overlap, which in practice they don't - a tooltip only shows
  // on hover over a shape, the marquee only while dragging empty canvas).
  const mainLayer = new Layer();
  const guidesLayer = new Layer({ listening: false });
  const tooltipLayer = new Layer();
  stage.add(mainLayer);
  stage.add(guidesLayer);
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

  // Initialize managers. The transformer is passed in (rather than
  // monkey-patched onto selectShape/deselectShape from out here, as
  // before docs/TASKS.md P2-1) so CanvasManager can keep it in sync
  // with a multi-shape selection itself - see CanvasManager's own
  // _syncTransformer for the text-mid-edit and single-Text-node
  // special cases this used to handle right here.
  const canvasManager = new CanvasManager(
    stage,
    mainLayer,
    tooltipLayer,
    transformer
  );

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
    guidesLayer,
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

  // Guards a narrow startup race: loadSavedCanvas() below does its own
  // async persistence.load() and only applies the result once that
  // resolves, but every other listener in this handler (Clear Canvas,
  // Ctrl+O/drag-and-drop import, ...) is already bound by the time that
  // await is reached, and control returns to the browser's event loop
  // right at that await - so a fast enough action (an e2e test's
  // synthetic drop event landed here in practice; a real user doing
  // this within single-digit milliseconds of page load is far less
  // likely but not impossible) can run before the initial load
  // resolves. Without this guard, the load would then silently
  // overwrite whatever that action just did with the (possibly stale,
  // possibly nonexistent) saved document - exactly the kind of data
  // loss this whole phase (docs/PRD.md Phase 1) exists to prevent. Only
  // set by actions that replace the *entire* canvas (Clear, import);
  // an incremental edit racing this same narrow window is not worth
  // the same protection - the load would just clobber that one change,
  // not the whole document, and self-heals on the next commit().
  let canvasReplacedBeforeInitialLoad = false;

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
      canvasReplacedBeforeInitialLoad = true;
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

  // --- JSON export / import (docs/TASKS.md P1-7) ---
  // A drawing needs to be able to leave the browser entirely, not just
  // survive a reload via Persistence - backed up, shared, moved to
  // another machine - and come back in exactly as saved. Export
  // downloads the same v2 document Persistence would save; import
  // reads one back via export/json.js's readDocumentFile
  // (parseDocument under the hood), so a legacy v1 save imports and
  // migrates exactly like an old localStorage save does. Only Ctrl+S/
  // Ctrl+O and drag-and-drop per docs/TASKS.md P1-7's own scope - a
  // toolbar entry point is P1-8's export dialog, not duplicated here.
  function exportJson() {
    const doc = buildCurrentDocument();
    const blob = exportJsonBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedFilename(doc);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const importFileInput = document.createElement("input");
  importFileInput.type = "file";
  importFileInput.accept = ".json,application/json";
  importFileInput.style.display = "none";
  document.body.appendChild(importFileInput);

  function triggerImport() {
    // Reset first: selecting the same file twice in a row (e.g. after
    // fixing it and re-exporting under the same name) wouldn't fire
    // "change" a second time otherwise, since the input's value
    // wouldn't actually change.
    importFileInput.value = "";
    importFileInput.click();
  }

  async function importDocumentFromFile(file) {
    let imported;
    try {
      imported = await readDocumentFile(file);
    } catch (e) {
      console.error("Failed to import drawing:", e);
      alert(
        `Could not import "${file.name}": ` +
          (e.message || "the file is not a valid FrameX drawing.")
      );
      return;
    }

    // Nothing to choose between if the canvas is already empty -
    // replace and merge would do the same thing, so skip the prompt.
    const hasExistingContent = canvasManager.shapes.length > 0;
    const replace =
      !hasExistingContent ||
      confirm(
        `Import "${file.name}"?\n\n` +
          "Click OK to replace everything currently on the canvas, or " +
          "Cancel to merge the imported shapes into what's already there."
      );

    canvasReplacedBeforeInitialLoad = true;
    // Same before/after commit() pairing as the Clear Canvas handler
    // below: the first captures whatever was on the canvas right
    // before the import as its own undo checkpoint, the second makes
    // the just-imported state the new one, so a single Ctrl+Z after an
    // import goes back to exactly the pre-import canvas.
    historyManager.commit();
    if (replace) {
      canvasManager.clearCanvas();
      canvasManager.loadDocumentObjects(imported.document.objects);
      // Adopt the imported file's own identity (id/name/timestamps) -
      // this document IS now what's on the canvas, the same as loading
      // a saved drawing on startup. A merge, below, keeps the current
      // document's identity instead: it's still fundamentally the same
      // drawing, just with more objects added to it.
      currentDocument = imported.document;
    } else {
      canvasManager.mergeDocumentObjects(imported.document.objects);
    }
    canvasManager.toolManager?.refreshInteractivity();
    canvasManager.deselectShape();
    transformer.nodes([]);
    mainLayer.batchDraw();
    updateAddFirstObjectCard();
    updatePropertiesPanel(null);
    historyManager.commit();
    // Immediate, not debounced: this is one deliberate action, not a
    // stream of edits, and the user shouldn't lose it to a closed tab
    // in the next 2-10s the way an in-progress drag's autosave might.
    await persistence.saveNow(buildCurrentDocument());
    showSaveStatus(replace ? "Canvas imported" : "Canvas merged");
  }

  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files?.[0];
    if (file) importDocumentFromFile(file);
  });

  // Drag-and-drop a .json file anywhere onto the canvas to import it,
  // with the same replace/merge choice as Ctrl+O. Both dragover and
  // drop must call preventDefault(): without it the browser's default
  // behavior is to navigate away and open the dropped file directly,
  // discarding the whole app.
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) importDocumentFromFile(file);
  });

  // --- Export Dialog (docs/TASKS.md P1-8) ---
  // Format/scale/background/selection-only options plus a live preview
  // thumbnail, for PNG/JPEG/PDF (JSON export has no options worth a
  // dialog over - it's the whole document, always - so Ctrl+S above
  // stays a direct download). ui/ExportDialog.js owns the actual
  // option-gathering and export logic (unit-tested there, the same way
  // as export/raster.js and export/pdf.js); everything here is just
  // wiring those functions to this page's specific DOM elements and the
  // Bootstrap modal already used for nothing else on this page.
  const exportModalEl = document.getElementById("exportModal");
  const exportFormatRadios = exportModalEl.querySelectorAll(
    'input[name="exportFormat"]'
  );
  const exportScaleSelect = document.getElementById("exportScale");
  const exportTransparentCheckbox =
    document.getElementById("exportTransparent");
  const exportBackgroundColorInput = document.getElementById(
    "exportBackgroundColor"
  );
  const exportSelectionOnlyCheckbox = document.getElementById(
    "exportSelectionOnly"
  );
  const exportPageSizeSelect = document.getElementById("exportPageSize");
  const exportOrientationSelect = document.getElementById("exportOrientation");
  const exportSelectableTextCheckbox = document.getElementById(
    "exportSelectableText"
  );
  const exportPreviewImg = document.getElementById("exportPreviewImg");
  const exportPreviewEmpty = document.getElementById("exportPreviewEmpty");
  const exportTransparentRow = document.getElementById("exportTransparentRow");
  const exportBackgroundRow = document.getElementById("exportBackgroundRow");
  const exportPdfOptions = document.getElementById("exportPdfOptions");
  const exportOrientationRow = document.getElementById("exportOrientationRow");
  const exportErrorEl = document.getElementById("exportError");
  const exportConfirmBtn = document.getElementById("exportConfirmBtn");

  function currentExportElements() {
    return {
      formatRadios: exportFormatRadios,
      scaleSelect: exportScaleSelect,
      transparentCheckbox: exportTransparentCheckbox,
      backgroundColorInput: exportBackgroundColorInput,
      selectionOnlyCheckbox: exportSelectionOnlyCheckbox,
      pageSizeSelect: exportPageSizeSelect,
      orientationSelect: exportOrientationSelect,
      selectableTextCheckbox: exportSelectableTextCheckbox,
    };
  }

  function currentExportFormat() {
    return [...exportFormatRadios].find((r) => r.checked)?.value || "png";
  }

  // Shows/hides each option group for the currently chosen format - a
  // transparency toggle means nothing for JPEG/PDF (raster.js/pdf.js
  // both always give JPEG a white background, and a PDF page is always
  // opaque), and PDF's own page-size/orientation/selectable-text
  // options mean nothing for a plain raster image.
  function updateExportOptionVisibility() {
    const format = currentExportFormat();
    const isPdf = format === "pdf";
    const isPng = format === "png";
    exportPdfOptions.style.display = isPdf ? "block" : "none";
    // A "fit to content" PDF page picks its own orientation from the
    // content's own aspect ratio (see export/pdf.js) - orientation only
    // means something for the fixed page sizes.
    exportOrientationRow.style.display =
      isPdf && exportPageSizeSelect.value !== "fit" ? "flex" : "none";
    exportTransparentRow.style.display = isPng ? "flex" : "none";
    exportBackgroundRow.style.display =
      !isPng || !exportTransparentCheckbox.checked ? "flex" : "none";
    // Exporting just the selected shape only makes sense when one is
    // actually selected (and Phase 1 has no multi-select yet, P2-1).
    const hasSelection = !!canvasManager.selectedShape;
    exportSelectionOnlyCheckbox.disabled = !hasSelection;
    if (!hasSelection) exportSelectionOnlyCheckbox.checked = false;
  }

  async function updateExportPreview() {
    const options = gatherExportOptions(currentExportElements());
    // Always a fast, low-resolution PNG for the preview, regardless of
    // the chosen format/scale: even a PDF's own preview is just the
    // same raster image it will embed (see export/pdf.js), and
    // re-rendering at full export resolution on every option change
    // would make the dialog feel sluggish for no visible benefit at
    // thumbnail size. This also means the preview never touches
    // exportPdf/jsPDF at all - only actually confirming a PDF export
    // below does, keeping jsPDF's ~340KB chunk (docs/TASKS.md P1-8's
    // bundle-size fix) out of the common "just look at the preview"
    // path too.
    const result = await runExport({
      stage,
      canvasManager,
      options: {
        ...options,
        format: "png",
        pixelRatio: 1,
      },
    });
    if (result.ok) {
      exportPreviewImg.src = result.dataUrl;
      exportPreviewImg.style.display = "block";
      exportPreviewEmpty.style.display = "none";
    } else {
      exportPreviewImg.style.display = "none";
      exportPreviewEmpty.textContent =
        result.reason === "empty" ? "Nothing to export" : result.message;
      exportPreviewEmpty.style.display = "flex";
    }
  }

  const debouncedUpdateExportPreview = debounce(updateExportPreview, 200);

  function refreshExportDialog() {
    updateExportOptionVisibility();
    debouncedUpdateExportPreview();
  }

  exportModalEl.addEventListener("show.bs.modal", () => {
    exportErrorEl.textContent = "";
    refreshExportDialog();
  });
  exportModalEl.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", refreshExportDialog);
  });

  exportConfirmBtn.addEventListener("click", async () => {
    exportErrorEl.textContent = "";
    const options = gatherExportOptions(currentExportElements());
    // A PDF export's first jsPDF dynamic import (export/pdf.js) can take
    // a perceptible moment - disable the button so a second click can't
    // start an overlapping export while the first is still in flight.
    exportConfirmBtn.disabled = true;
    const previousLabel = exportConfirmBtn.textContent;
    exportConfirmBtn.textContent = "Exporting...";
    let result;
    try {
      result = await runExport({ stage, canvasManager, options });
    } finally {
      exportConfirmBtn.disabled = false;
      exportConfirmBtn.textContent = previousLabel;
    }
    if (!result.ok) {
      exportErrorEl.textContent = result.message;
      return;
    }
    // A data: URL works directly as a download link's href - no need
    // to also round-trip it through a Blob/ObjectURL the way
    // exportJson() does above (that one starts from a document object,
    // not a data URL already in hand).
    const link = document.createElement("a");
    link.href = result.dataUrl;
    link.download = suggestedExportFilename(currentDocument, options.format);
    document.body.appendChild(link);
    link.click();
    link.remove();
    Modal.getOrCreateInstance(exportModalEl).hide();
  });

  function openExportDialog() {
    Modal.getOrCreateInstance(exportModalEl).show();
  }

  // --- Print (docs/TASKS.md P1-9, Ctrl+P) ---
  function printCanvasNow() {
    const result = printCanvas(stage);
    if (!result.ok) {
      // Same failure shape and only failure mode as the export dialog's
      // own "empty canvas" case (see ui/ExportDialog.js) - an alert is
      // enough here since, unlike the dialog, there's no persistent
      // error area a keyboard-only shortcut could show it in.
      alert(result.message);
    }
  }

  // All global keyboard shortcuts (undo/redo, zoom, delete, escape,
  // JSON export/import, the export dialog, print) live in
  // ui/Shortcuts.js, not inline here - see that file for behavior and
  // comments. updatePropertiesPanel is a hoisted function declaration
  // defined further down in this same scope; passing it here is safe
  // regardless of source order since this call only runs once the whole
  // DOMContentLoaded handler's declarations have all been hoisted.
  bindShortcuts({
    historyManager,
    canvasManager,
    toolManager,
    mainLayer,
    zoomIn,
    zoomOut,
    resetZoom,
    updatePropertiesPanel,
    exportJson,
    triggerImport,
    openExportDialog,
    printCanvas: printCanvasNow,
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
      // Deletes the whole selection, not just the properties panel's
      // own single displayed shape, for the same reason the Delete key
      // does (see ui/Shortcuts.js) - this button and that key both mean
      // "delete what's selected", and a multi-selection is still all
      // "selected" even though this panel only ever shows one shape's
      // fields at a time (docs/TASKS.md P3-5 is where a real multi-edit
      // panel would live, not here).
      if (window.canvasManager.selectedShapes.length > 0) {
        window.canvasManager.removeShapes(window.canvasManager.selectedShapes);
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
    let loaded = null;
    let migrated = false;
    let loadFailed = false;
    try {
      ({ document: loaded, migrated } = await persistence.load());
    } catch (e) {
      console.error("Failed to restore canvas:", e);
      loadFailed = true;
    }

    // See canvasReplacedBeforeInitialLoad's own comment above: Clear
    // Canvas or an import already ran while this load was still in
    // flight, so applying it now (or resetting undo history to just
    // this one state, below) would silently discard what that action
    // just did. Whichever landed first wins; this one is dropped.
    if (canvasReplacedBeforeInitialLoad) return;

    if (loadFailed) {
      showSaveStatus("Failed to load canvas");
    } else if (loaded) {
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
    historyManager.reset(getCurrentData());
    updateAddFirstObjectCard();
  }

  await loadSavedCanvas();
});

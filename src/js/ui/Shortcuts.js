/**
 * All global keyboard shortcuts for the canvas page: undo/redo, zoom,
 * delete, and escape-to-deselect. Extracted from main.js (docs/TASKS.md
 * P0-9) so it is a self-contained, unit-of-behavior module instead of an
 * inline listener buried in the composition root; the app's remaining
 * per-tool key handling (e.g. the pen tool's own drawing logic) stays
 * where it is, in ToolManager, since it isn't a general app-wide
 * shortcut.
 *
 * @param {object} deps
 * @param {import("../core/HistoryManager.js").HistoryManager} deps.historyManager
 * @param {import("../canvas/CanvasManager.js").CanvasManager} deps.canvasManager
 * @param {import("../canvas/ToolManager.js").ToolManager} deps.toolManager
 * @param {import("konva/lib/shapes/Transformer").Transformer} deps.transformer
 * @param {import("konva/lib/Layer").Layer} deps.mainLayer
 * @param {() => void} deps.zoomIn
 * @param {() => void} deps.zoomOut
 * @param {() => void} deps.resetZoom
 * @param {(shape: unknown) => void} deps.updatePropertiesPanel
 * @returns {() => void} an unbind function, for tests or a future
 *   settings/help-overlay feature that needs to temporarily suspend
 *   shortcuts.
 */
export function bindShortcuts({
  historyManager,
  canvasManager,
  toolManager,
  transformer,
  mainLayer,
  zoomIn,
  zoomOut,
  resetZoom,
  updatePropertiesPanel,
}) {
  function handleKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    // e.key reflects Shift: the "Z" key reports "z" normally but "Z"
    // (uppercase) once Shift is held, so Ctrl+Shift+Z never matched
    // e.key === "z" before this fix and the standard redo shortcut
    // silently did nothing (Ctrl+Y still worked). Comparing lower-cased
    // is robust to Shift and to CapsLock.
    const key = e.key.toLowerCase();
    if (mod && !e.target.closest("input, textarea, select")) {
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        historyManager.undo();
        return;
      }
      if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        historyManager.redo();
        return;
      }
    }
    if (mod && e.key === "=") {
      e.preventDefault();
      zoomIn();
    } else if (mod && e.key === "-") {
      e.preventDefault();
      zoomOut();
    } else if (mod && e.key === "0") {
      e.preventDefault();
      resetZoom();
      return;
    }

    // Delete/Backspace removes the current selection. Suppressed while
    // typing in an input/textarea/select (e.g. the properties panel's
    // Name field) so correcting a typo never deletes the shape.
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      !e.target.closest("input, textarea, select")
    ) {
      if (canvasManager.selectedShape) {
        e.preventDefault();
        canvasManager.removeShape(canvasManager.selectedShape);
        canvasManager.deselectShape();
        updatePropertiesPanel(null);
      }
      return;
    }

    // Escape deselects the current shape and returns to the select tool.
    // Also suppressed while typing; the inline text editor handles its
    // own Escape to cancel editing (see TextManager.startEditing).
    if (e.key === "Escape" && !e.target.closest("input, textarea, select")) {
      e.preventDefault();
      toolManager.setTool("cursor");
      canvasManager.deselectShape();
      transformer.nodes([]);
      updatePropertiesPanel(null);
      mainLayer.batchDraw();
    }
  }

  document.addEventListener("keydown", handleKeydown);
  return () => document.removeEventListener("keydown", handleKeydown);
}

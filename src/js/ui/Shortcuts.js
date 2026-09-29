/**
 * All global keyboard shortcuts for the canvas page (docs/TASKS.md
 * P2-3 extends the original undo/redo/zoom/delete/escape set from
 * P0-9 with tool/shape switches, zoom-to-fit and the "?" Help dialog).
 * Extracted from main.js (P0-9) so it is a self-contained, unit-of-
 * behavior module instead of an inline listener buried in the
 * composition root; the app's remaining per-tool key handling (e.g.
 * the pen tool's own drawing logic) stays where it is, in ToolManager,
 * since it isn't a general app-wide shortcut.
 *
 * Every shortcut bound here has a matching entry in
 * ui/shortcuts-data.js, the Help dialog's own source of data - see
 * that file's comment for which of the PRD's full Appendix B table
 * this deliberately does NOT include yet (features this app doesn't
 * have at all), and why.
 *
 * @param {object} deps
 * @param {import("../core/HistoryManager.js").HistoryManager} deps.historyManager
 * @param {import("../canvas/CanvasManager.js").CanvasManager} deps.canvasManager
 * @param {import("../canvas/ToolManager.js").ToolManager} deps.toolManager
 * @param {import("../canvas/ShapeManager.js").ShapeManager} deps.shapeManager
 * @param {import("../canvas/TextManager.js").TextManager} deps.textManager
 * @param {import("konva/lib/Layer").Layer} deps.mainLayer
 * @param {() => void} deps.zoomIn
 * @param {() => void} deps.zoomOut
 * @param {() => void} deps.resetZoom
 * @param {() => void} deps.zoomToFit
 * @param {(shape: unknown) => void} deps.updatePropertiesPanel
 * @param {() => void} [deps.exportJson] Ctrl+S (docs/TASKS.md P1-7).
 *   Optional so tests/callers that don't need it can omit it.
 * @param {() => void} [deps.triggerImport] Ctrl+O (docs/TASKS.md P1-7).
 * @param {() => void} [deps.openExportDialog] Ctrl+E (docs/TASKS.md P1-8):
 *   the PNG/JPEG/PDF export dialog, as opposed to exportJson's direct
 *   Ctrl+S download.
 * @param {() => void} [deps.printCanvas] Ctrl+P (docs/TASKS.md P1-9).
 * @param {() => void} [deps.openHelpDialog] "?" (docs/TASKS.md P2-3).
 * @returns {() => void} an unbind function, for tests or a future
 *   settings/help-overlay feature that needs to temporarily suspend
 *   shortcuts.
 */
// Arrow-key nudge (docs/TASKS.md P2-5): 1px per press, 10px with Shift.
const NUDGE_DELTAS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export function bindShortcuts({
  historyManager,
  canvasManager,
  toolManager,
  shapeManager,
  textManager,
  mainLayer,
  zoomIn,
  zoomOut,
  resetZoom,
  zoomToFit,
  updatePropertiesPanel,
  exportJson,
  triggerImport,
  openExportDialog,
  printCanvas,
  openHelpDialog,
}) {
  function handleKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    // e.key reflects Shift: the "Z" key reports "z" normally but "Z"
    // (uppercase) once Shift is held, so Ctrl+Shift+Z never matched
    // e.key === "z" before this fix and the standard redo shortcut
    // silently did nothing (Ctrl+Y still worked). Comparing lower-cased
    // is robust to Shift and to CapsLock.
    const key = e.key.toLowerCase();
    const typing = !!e.target.closest("input, textarea, select");

    if (mod && !typing) {
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
      // Ctrl/Cmd+S: JSON export. Always prevented (even without a
      // handler) so the browser's own "Save Page As" dialog never
      // fires here - that would save the app's HTML shell, not the
      // drawing, which is never what a user pressing Ctrl+S wants.
      if (key === "s") {
        e.preventDefault();
        exportJson?.();
        return;
      }
      // Ctrl/Cmd+O: JSON import. Same reasoning - the browser's native
      // "Open File" dialog is never useful on this page.
      if (key === "o") {
        e.preventDefault();
        triggerImport?.();
        return;
      }
      // Ctrl/Cmd+E: the PNG/JPEG/PDF export dialog (docs/TASKS.md P1-8).
      // Not a browser-reserved shortcut like S/O above, but prevented
      // anyway for consistency and in case some browser/extension binds
      // it to something else.
      if (key === "e") {
        e.preventDefault();
        openExportDialog?.();
        return;
      }
      // Ctrl/Cmd+P: print (docs/TASKS.md P1-9). Always prevented so the
      // browser's own print dialog never opens against the app's full
      // page (toolbars, panels and all) instead of just the drawing.
      if (key === "p") {
        e.preventDefault();
        printCanvas?.();
        return;
      }
      // Ctrl/Cmd+A: select every shape (docs/TASKS.md P2-1). Always
      // prevented so the browser's own "select all page text" never
      // fires instead.
      if (key === "a") {
        e.preventDefault();
        canvasManager.selectAll();
        return;
      }
      // Ctrl/Cmd+C / +X / +D: copy/cut/duplicate the current selection
      // (docs/TASKS.md P2-4), into this app's own in-memory clipboard -
      // see canvas/Clipboard.js's own comment for why that's not the OS
      // clipboard. Paste (+V) is deliberately NOT handled here: it needs
      // the native "paste" DOM event's clipboardData to also support
      // pasting an image or plain text copied from outside the app (see
      // main.js's own "paste" listener), which a keydown handler has no
      // access to. Prevented even with nothing selected, so e.g. Ctrl+D
      // never falls through to the browser's own "bookmark this page".
      if (key === "c") {
        e.preventDefault();
        canvasManager.copySelection();
        return;
      }
      if (key === "x") {
        e.preventDefault();
        canvasManager.cutSelection();
        return;
      }
      if (key === "d") {
        e.preventDefault();
        canvasManager.duplicateSelection();
        return;
      }
      // Ctrl/Cmd+G / +Shift+G: group / ungroup the current selection
      // (docs/TASKS.md P2-6). Same shiftKey-branches-on-one-key pattern
      // as Undo/Redo above. Always prevented, even when it turns out to
      // be a no-op (fewer than 2 groupable shapes selected for group; no
      // single real group selected for ungroup - see
      // CanvasManager.groupSelection/ungroupSelection's own guards) -
      // there's no useful browser-native behavior on Ctrl+G to fall back
      // to either way.
      if (key === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          canvasManager.ungroupSelection();
        } else {
          canvasManager.groupSelection();
        }
        return;
      }
    }
    if (mod && e.key === "=") {
      e.preventDefault();
      zoomIn();
      return;
    } else if (mod && e.key === "-") {
      e.preventDefault();
      zoomOut();
      return;
    } else if (mod && e.key === "0") {
      e.preventDefault();
      resetZoom();
      return;
    }

    // Shift+1: zoom to fit (docs/TASKS.md P2-3/PRD Appendix B). Reading
    // e.code rather than e.key: Shift+1 reports e.key as "!" on a
    // standard US layout (the character actually produced), which
    // would make this shortcut layout-dependent; e.code identifies the
    // physical "1" key regardless of what Shift turns it into.
    if (e.shiftKey && !mod && e.code === "Digit1" && !typing) {
      e.preventDefault();
      zoomToFit();
      return;
    }

    // Single-letter tool/shape shortcuts (docs/TASKS.md P2-3): never
    // combined with Ctrl/Cmd (that's the mod-gated block above) and
    // suppressed while typing, same reasoning as Delete/Escape below.
    // Each just calls the exact same method its equivalent toolbar
    // button does - see ui/shortcuts-data.js for the full list this is
    // kept in sync with.
    if (!mod && !typing) {
      switch (key) {
        case "v":
          e.preventDefault();
          toolManager.setTool("cursor");
          return;
        case "p":
          e.preventDefault();
          toolManager.setTool("pen");
          return;
        case "n":
          e.preventDefault();
          toolManager.setTool("note");
          return;
        case "t":
          e.preventDefault();
          textManager.createText();
          return;
        case "r":
          e.preventDefault();
          shapeManager.createRectangle();
          return;
        case "o":
          e.preventDefault();
          shapeManager.createCircle();
          return;
        case "l":
          e.preventDefault();
          shapeManager.createLine();
          return;
        default:
          break;
      }
    }

    // "?": Help dialog listing every shortcut above (docs/TASKS.md
    // P2-3). Suppressed while typing, same as everything else below -
    // "?" is an ordinary punctuation character (e.g. naming a shape
    // "What is this?"), and popping a modal over every such keystroke
    // would be far more disruptive than making a genuine help request
    // click out of the field first.
    if (e.key === "?" && !typing) {
      e.preventDefault();
      openHelpDialog?.();
      return;
    }

    // Arrow-key nudge (docs/TASKS.md P2-5): moves the whole selection by
    // 1px, or 10px with Shift held - never combined with Ctrl/Cmd (no
    // such shortcut exists) and suppressed while typing, same as every
    // other shortcut here; that includes TextManager's own inline-edit
    // textarea, a real <textarea> the `typing` check already matches, so
    // arrow keys there move the text cursor, not the shape being edited.
    // Only prevented with something actually selected to move - same
    // reasoning as Delete/Backspace below, so an arrow key with nothing
    // selected still does whatever a plain arrow key normally does.
    const nudge = NUDGE_DELTAS[e.key];
    if (nudge && !mod && !typing) {
      if (canvasManager.selectedShapes.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        canvasManager.nudgeSelection(nudge.x * step, nudge.y * step);
      }
      return;
    }

    // Delete/Backspace removes the whole current selection (one shape
    // or several - docs/TASKS.md P2-1), via removeShapes so a
    // multi-delete commits one undo checkpoint, not one per shape (see
    // CanvasManager.removeShapes' own comment). Suppressed while typing
    // in an input/textarea/select (e.g. the properties panel's Name
    // field) so correcting a typo never deletes the shape.
    if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
      if (canvasManager.selectedShapes.length > 0) {
        e.preventDefault();
        canvasManager.removeShapes(canvasManager.selectedShapes);
        canvasManager.deselectShape();
        updatePropertiesPanel(null);
      }
      return;
    }

    // Escape deselects the current selection and returns to the select
    // tool. Also suppressed while typing; the inline text editor
    // handles its own Escape to cancel editing (see
    // TextManager.startEditing). deselectShape() itself keeps the
    // transformer's wrapped nodes in sync (CanvasManager's own
    // _syncTransformer), so nothing here needs to touch it directly.
    if (e.key === "Escape" && !typing) {
      e.preventDefault();
      toolManager.setTool("cursor");
      canvasManager.deselectShape();
      updatePropertiesPanel(null);
      mainLayer.batchDraw();
    }
  }

  document.addEventListener("keydown", handleKeydown);
  return () => document.removeEventListener("keydown", handleKeydown);
}

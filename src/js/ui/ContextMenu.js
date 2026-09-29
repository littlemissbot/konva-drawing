/**
 * Right-click context menu (docs/PRD.md SEL-6, docs/TASKS.md P2-10):
 * "Right-click on object or canvas shows cut, copy, paste, duplicate,
 * delete, lock, z-order, align, group." One flat menu for both cases -
 * PRD's own wording lists the same items for "object or canvas" rather
 * than two different menus - with items that don't apply to the current
 * selection disabled rather than hidden, so the menu's shape never
 * jumps around depending on what was clicked.
 *
 * Split the same way ui/HelpDialog.js and ui/ExportDialog.js already
 * are: `buildContextMenuItems`/`renderContextMenuHtml` are pure
 * functions (given a canvasManager-shaped object, no real DOM needed)
 * so the menu's actual content/enablement logic is unit-testable; the
 * `ContextMenu` class below is the DOM wiring (positioning, show/hide,
 * dismiss-on-outside-click/Escape) that a real page needs.
 */
import { GROUPABLE_CLASS_NAMES } from "../canvas/CanvasManager.js";
import { detectMac, formatKeys } from "./HelpDialog.js";

/**
 * The menu's contents for the current state of `canvasManager` - one
 * entry per row, either `{ id, label, keys, action, disabled }` or
 * `{ separator: true }`. `keys` is an Appendix-B-style "Mod+X" string
 * (or omitted for the align/distribute items, which have no shortcut -
 * see ui/shortcuts-data.js's own comment on why) - formatted for the
 * reader's platform by the caller (ContextMenu.render), same split
 * ui/HelpDialog.js's formatKeys/buildShortcutSections already use.
 */
export function buildContextMenuItems(canvasManager) {
  const shapes = canvasManager.selectedShapes;
  const hasSelection = shapes.length > 0;
  const hasMultiple = shapes.length >= 2;
  const hasClipboard = canvasManager.clipboard.hasContent;
  const allLocked = hasSelection && shapes.every((s) => !!s.getAttr("locked"));
  const isSingleRealGroup =
    shapes.length === 1 &&
    shapes[0].getClassName() === "Group" &&
    shapes[0].getAttr("toolType") === "group";
  const canGroup =
    hasMultiple &&
    shapes.every((s) => GROUPABLE_CLASS_NAMES.has(s.getClassName()));

  return [
    {
      id: "cut",
      label: "Cut",
      keys: "Mod+X",
      disabled: !hasSelection,
      action: () => canvasManager.cutSelection(),
    },
    {
      id: "copy",
      label: "Copy",
      keys: "Mod+C",
      disabled: !hasSelection,
      action: () => canvasManager.copySelection(),
    },
    {
      id: "paste",
      label: "Paste",
      keys: "Mod+V",
      disabled: !hasClipboard,
      action: () => canvasManager.pasteClipboard(),
    },
    {
      id: "duplicate",
      label: "Duplicate",
      keys: "Mod+D",
      disabled: !hasSelection,
      action: () => canvasManager.duplicateSelection(),
    },
    {
      id: "delete",
      label: "Delete",
      keys: "Delete",
      disabled: !hasSelection,
      action: () => canvasManager.removeShapes(canvasManager.selectedShapes),
    },
    { separator: true },
    {
      id: "lock",
      label: allLocked ? "Unlock" : "Lock",
      keys: "Mod+L",
      disabled: !hasSelection,
      action: () => canvasManager.toggleLockSelection(),
    },
    { separator: true },
    {
      id: "bringToFront",
      label: "Bring to Front",
      keys: "Mod+Shift+]",
      disabled: !hasSelection,
      action: () => canvasManager.bringToFront(),
    },
    {
      id: "bringForward",
      label: "Bring Forward",
      keys: "Mod+]",
      disabled: !hasSelection,
      action: () => canvasManager.bringForward(),
    },
    {
      id: "sendBackward",
      label: "Send Backward",
      keys: "Mod+[",
      disabled: !hasSelection,
      action: () => canvasManager.sendBackward(),
    },
    {
      id: "sendToBack",
      label: "Send to Back",
      keys: "Mod+Shift+[",
      disabled: !hasSelection,
      action: () => canvasManager.sendToBack(),
    },
    { separator: true },
    {
      id: "alignLeft",
      label: "Align Left",
      disabled: !hasMultiple,
      action: () => canvasManager.alignLeft(),
    },
    {
      id: "alignCenter",
      label: "Align Center",
      disabled: !hasMultiple,
      action: () => canvasManager.alignCenter(),
    },
    {
      id: "alignRight",
      label: "Align Right",
      disabled: !hasMultiple,
      action: () => canvasManager.alignRight(),
    },
    {
      id: "alignTop",
      label: "Align Top",
      disabled: !hasMultiple,
      action: () => canvasManager.alignTop(),
    },
    {
      id: "alignMiddle",
      label: "Align Middle",
      disabled: !hasMultiple,
      action: () => canvasManager.alignMiddle(),
    },
    {
      id: "alignBottom",
      label: "Align Bottom",
      disabled: !hasMultiple,
      action: () => canvasManager.alignBottom(),
    },
    {
      id: "distributeHorizontally",
      label: "Distribute Horizontally",
      disabled: !hasMultiple,
      action: () => canvasManager.distributeHorizontally(),
    },
    {
      id: "distributeVertically",
      label: "Distribute Vertically",
      disabled: !hasMultiple,
      action: () => canvasManager.distributeVertically(),
    },
    { separator: true },
    {
      id: "group",
      label: "Group",
      keys: "Mod+G",
      disabled: !canGroup,
      action: () => canvasManager.groupSelection(),
    },
    {
      id: "ungroup",
      label: "Ungroup",
      keys: "Mod+Shift+G",
      disabled: !isSingleRealGroup,
      action: () => canvasManager.ungroupSelection(),
    },
  ];
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]
  );
}

/** The menu's inner HTML for a given item list, platform-resolving each
 * item's `keys` the same way ui/HelpDialog.js's formatKeys does. Each
 * enabled row is a real `<button>` (keyboard/screen-reader friendly,
 * and the only element type this focuses/clicks), tagged with
 * `data-item-id` so ContextMenu's own click handler can look the
 * action back up without embedding it in the HTML string. */
export function renderContextMenuHtml(items, isMac) {
  return items
    .map((item) => {
      if (item.separator) return '<li class="context-menu-separator"></li>';
      const keysHtml = item.keys
        ? `<kbd>${escapeHtml(formatKeys(item.keys, isMac))}</kbd>`
        : "";
      return `<li><button type="button" class="context-menu-item" data-item-id="${escapeHtml(item.id)}" ${item.disabled ? "disabled" : ""}>${escapeHtml(item.label)}${keysHtml}</button></li>`;
    })
    .join("\n");
}

/** DOM wiring: opens `menuEl` (an empty <ul>, e.g. canvas.html's
 * #contextMenu) at a right-click's position, populated from
 * `canvasManager`'s current state, and closes it on an outside
 * click/Escape or after an item runs. Konva's own "contextmenu" event
 * (bound by the caller, e.g. main.js on the Stage) is the trigger - this
 * class only owns the menu element itself. */
export class ContextMenu {
  constructor({ menuEl, canvasManager }) {
    this.menuEl = menuEl;
    this.canvasManager = canvasManager;
    this.isMac = detectMac();
    this._onDocumentClick = (e) => {
      if (!this.menuEl.contains(e.target)) this.close();
    };
    this._onKeydown = (e) => {
      if (e.key === "Escape") this.close();
    };
    this.menuEl.addEventListener("click", (e) => {
      const button = e.target.closest("button[data-item-id]");
      if (!button || button.disabled) return;
      const item = this._items?.find((i) => i.id === button.dataset.itemId);
      this.close();
      item?.action();
    });
  }

  /** Opens the menu at viewport coordinates (x, y) - a right-click
   * event's own clientX/clientY - clamped so it never renders partly
   * off-screen. */
  open(x, y) {
    this._items = buildContextMenuItems(this.canvasManager);
    this.menuEl.innerHTML = renderContextMenuHtml(this._items, this.isMac);
    this.menuEl.classList.add("open");

    // Measure after it's visible (an unopened <ul>'s own size is 0x0),
    // then clamp so the menu stays fully inside the viewport instead of
    // being cut off/opening partially off-screen near an edge.
    const { offsetWidth, offsetHeight } = this.menuEl;
    const maxX = window.innerWidth - offsetWidth - 4;
    const maxY = window.innerHeight - offsetHeight - 4;
    this.menuEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
    this.menuEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;

    // Listening on "click" (not "contextmenu"/"mousedown") for the
    // outside-close check means the right-click that opened this menu
    // never immediately closes it again - "click" doesn't fire for the
    // secondary mouse button at all, only left-click and Enter/Space on
    // a focused element do. Added after open() returns (queued via
    // setTimeout(0)) so this same right-click's own event, still
    // finishing dispatch, can't be captured by it.
    setTimeout(() => {
      document.addEventListener("click", this._onDocumentClick);
      document.addEventListener("keydown", this._onKeydown);
    }, 0);
  }

  close() {
    this.menuEl.classList.remove("open");
    document.removeEventListener("click", this._onDocumentClick);
    document.removeEventListener("keydown", this._onKeydown);
  }
}

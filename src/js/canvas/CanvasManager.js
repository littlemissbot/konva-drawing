import { Text } from "konva/lib/shapes/Text";
import { Circle } from "konva/lib/shapes/Circle";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { RegularPolygon } from "konva/lib/shapes/RegularPolygon";
import { Star } from "konva/lib/shapes/Star";
import { Group } from "konva/lib/Group";
import Konva from "konva";
import { createId } from "../core/Document.js";
import { Selection } from "./Selection.js";
import { Clipboard } from "./Clipboard.js";

// Default paste/duplicate offset (docs/TASKS.md P2-4): visibly distinct
// from the original without straying far, and consistently diagonal so
// repeated pastes/duplicates fan out instead of stacking exactly on top
// of each other.
const CLIPBOARD_OFFSET = { x: 20, y: 20 };

// Shape types groupSelection (docs/TASKS.md P2-6) will fold into a
// group. Deliberately excludes StickyNote and Image (className "Group"/
// "Image", so already outside this set) and a group itself (also
// "Group") - grouping any of those would mean recursively serializing a
// nested Group, or an Image's async Konva.Image.fromURL load, as a
// group *child*, which reconstructShapes' Group case below does not
// support (only the plain synchronous shape types do, via
// _buildSimpleShape). A future task can extend this if a real need for
// nested/image-bearing groups shows up; today's grouping needs (basic
// shapes, freehand strokes, text) are all synchronous already.
const GROUPABLE_CLASS_NAMES = new Set([
  "Circle",
  "Rect",
  "Line",
  "RegularPolygon",
  "Star",
  "Text",
]);

export class CanvasManager {
  // `transformer` is optional (existing tests construct a CanvasManager
  // without one, and nothing here breaks without it - _syncTransformer
  // just no-ops) - main.js is the one real caller that passes its own
  // Konva.Transformer, so multi-select (docs/TASKS.md P2-1) can keep it
  // in sync with the selection itself instead of main.js reaching back
  // in via the selectShape/deselectShape monkey-patch this replaces.
  constructor(stage, mainLayer, tooltipLayer, transformer = null) {
    this.stage = stage;
    this.mainLayer = mainLayer;
    this.tooltipLayer = tooltipLayer;
    this.transformer = transformer;
    this.selection = new Selection();
    this.clipboard = new Clipboard();
    this.shapes = [];
    this.connections = [];
    this.textManager = null;
    this.toolManager = null;
    // "Entered" group state (docs/TASKS.md P2-6): the Group a double-
    // click most recently entered, so a later plain click on one of its
    // children selects that child instead of the whole group. Cleared
    // whenever the selection moves outside that group's own children -
    // see selectShape/toggleSelect/selectShapes/deselectShape below.
    this._enteredGroup = null;
    this._groupCount = 0;

    this.setupEventListeners();
  }

  /** The most recently selected shape, or null - for UI that only ever
   * cares about one shape (the properties panel's fields, single-shape
   * paths elsewhere). See Selection.primary for what "most recent"
   * means. Multi-aware code should use `selectedShapes` instead. */
  get selectedShape() {
    return this.selection.primary;
  }

  /** Every currently selected shape, as a plain array. */
  get selectedShapes() {
    return this.selection.shapes;
  }

  setTextManager(textManager) {
    this.textManager = textManager;
  }

  setToolManager(toolManager) {
    this.toolManager = toolManager;
  }

  toStorageShape(shape) {
    if (
      shape.getClassName() === "Group" &&
      shape.getAttr("toolType") === "group"
    ) {
      // A real group (docs/TASKS.md P2-6, as opposed to the "sticky"
      // toolType below, which is also a Group but a different feature):
      // recurses through toStorageShape itself for each child, the same
      // per-type logic used everywhere else - reconstructShapes' own
      // Group case only supports rebuilding the synchronous shape types
      // this produces (see GROUPABLE_CLASS_NAMES/_buildSimpleShape), so
      // there is nothing here to recurse into that it can't already
      // handle.
      return {
        type: "Group",
        attrs: {
          id: shape.id(),
          x: shape.x(),
          y: shape.y(),
          rotation: shape.rotation(),
          scaleX: shape.scaleX(),
          scaleY: shape.scaleY(),
          opacity: shape.opacity(),
          name: shape.getAttr("name") || "",
          locked: !!shape.getAttr("locked"),
          children: shape
            .getChildren()
            .map((child) => this.toStorageShape(child)),
        },
      };
    }
    if (
      shape.getClassName() === "Group" &&
      shape.getAttr("toolType") === "sticky"
    ) {
      const rect = shape.findOne("Rect");
      const textNode = shape.findOne("Text");
      return {
        type: "StickyNote",
        attrs: {
          id: shape.id(),
          x: shape.x(),
          y: shape.y(),
          rotation: shape.rotation(),
          scaleX: shape.scaleX(),
          scaleY: shape.scaleY(),
          opacity: shape.opacity(),
          name: shape.name(),
          locked: !!shape.getAttr("locked"),
          rect: rect ? rect.getAttrs() : {},
          text: textNode
            ? {
                ...textNode.getAttrs(),
                text: textNode.text(),
              }
            : {},
        },
      };
    }
    const type = shape.getClassName();
    if (type === "Image") {
      // Image nodes carry the live HTMLImageElement under the "image"
      // attr, which is not serializable (and not meaningful) JSON, so
      // this type gets an explicit allow-list instead of the generic
      // attrs spread used below. iconFile is the origin-independent
      // asset reference for a bundled SVG icon (SVGManager.createSVG);
      // imageSrc is a self-contained data: URL for an image pasted from
      // the system clipboard (docs/TASKS.md P2-4, ShapeManager.
      // createImageFromDataUrl) - there is no bundled asset file to
      // reference, so the pixels themselves are embedded directly. A
      // shape only ever carries one of the two.
      const attrs = shape.getAttrs();
      const base = {
        id: shape.id(),
        x: shape.x(),
        y: shape.y(),
        width: shape.width(),
        height: shape.height(),
        rotation: shape.rotation(),
        scaleX: shape.scaleX(),
        scaleY: shape.scaleY(),
        opacity: shape.opacity(),
        draggable: shape.draggable(),
        name: shape.getAttr("name") || "",
        locked: !!shape.getAttr("locked"),
      };
      return {
        type,
        attrs: attrs.iconFile
          ? { ...base, iconFile: attrs.iconFile }
          : { ...base, imageSrc: attrs.imageSrc || "" },
      };
    }
    const attrs = shape.getAttrs();
    return {
      type,
      attrs: {
        ...attrs,
        name: shape.getAttr("name") || "",
        text: shape.getAttr("text") || "",
      },
    };
  }

  setupEventListeners() {
    this.stage.on("click", (e) => {
      if (e.target === this.stage) {
        // See ToolManager.consumeSuppressedClick's own comment: a real
        // marquee drag (docs/TASKS.md P2-2) sets this the moment it's
        // confirmed to be a real drag, specifically so it's already
        // true by the time this fires - without it, this handler would
        // immediately deselect whatever the marquee just selected.
        if (this.toolManager?.consumeSuppressedClick()) return;
        this.deselectShape();
      }
    });

    window.eventBus.on("shapeSelected", (shape) => {
      this.selectShape(shape);
    });

    window.eventBus.on("shapeDeselected", () => {
      this.deselectShape();
    });

    // Shift-click (docs/TASKS.md P2-1): toggles one shape's membership
    // without touching the rest of the selection. Emitted by
    // setupShapeEvents' own click handler below, kept as a separate
    // event from "shapeSelected" (which always replaces the whole
    // selection with just its one shape) rather than overloading that
    // event with a shiftKey flag, since every other "shapeSelected"
    // emitter (shape creation in ToolManager/TextManager/SVGManager)
    // means "this new shape is now the selection", never "add to it".
    window.eventBus.on("shapeToggled", (shape) => {
      this.toggleSelect(shape);
    });
  }

  /** Replaces the whole selection with just this one shape - what a
   * plain (non-Shift) click, or creating a new shape, means. */
  selectShape(shape) {
    this._exitGroupUnless(shape);
    this.selection.selectOnly(shape);
    this._afterSelectionChanged();
  }

  /** Shift-click: adds `shape` to the selection if it wasn't already
   * there, removes it if it was - the rest of the selection is
   * untouched either way. */
  toggleSelect(shape) {
    this._exitGroupUnless(shape);
    this.selection.toggle(shape);
    this._afterSelectionChanged();
  }

  // Clears the "entered" group (docs/TASKS.md P2-6) unless `shape` is
  // that same group or one of its own children - i.e. unless the
  // selection change is still "inside" the group the user double-
  // clicked into. Selecting anything else (another top-level shape, a
  // different group, one of a *different* group's children) exits it,
  // the same click-away convention design tools like Figma/Illustrator
  // use.
  _exitGroupUnless(shape) {
    if (
      this._enteredGroup &&
      shape !== this._enteredGroup &&
      shape?.getParent?.() !== this._enteredGroup
    ) {
      this._enteredGroup = null;
    }
  }

  /** Every shape becomes selected (Ctrl+A). */
  selectAll() {
    this.selectShapes(this.shapes);
  }

  /** Selects every shape given (docs/TASKS.md P2-2's marquee select is
   * the main caller, with a whole batch at once rather than one shape
   * at a time): replaces the whole selection, or unions into it when
   * `additive` is true (Shift held during the marquee drag) - the same
   * union semantics toggleSelect gives a single shift-clicked shape,
   * just for a batch. */
  selectShapes(shapes, { additive = false } = {}) {
    // A batch selection (marquee, Ctrl+A) always exits any entered group
    // (docs/TASKS.md P2-6) - it inherently spans outside a single
    // group's own children, unlike selectShape/toggleSelect's single-
    // target case above.
    this._enteredGroup = null;
    if (additive) {
      shapes.forEach((shape) => this.selection.add(shape));
    } else {
      this.selection.set(shapes);
    }
    this._afterSelectionChanged();
  }

  /** Clears the selection entirely - a plain click on empty canvas,
   * Escape, or any single/multi delete. Also exits any entered group
   * (docs/TASKS.md P2-6), the same as clicking away from it. */
  deselectShape() {
    this._enteredGroup = null;
    if (this.selection.size > 0) {
      this.selection.clear();
      this._afterSelectionChanged();
    }
  }

  /** Common tail of every selection-changing method above: redraws,
   * tells the properties panel what to show (still just the primary
   * shape - a full multi-shape properties panel is P3-5's job, not
   * this phase's), and keeps the transformer's wrapped nodes in sync
   * with the selection itself. */
  _afterSelectionChanged() {
    this.mainLayer.batchDraw();
    window.eventBus.emit("propertiesUpdate", this.selection.primary);
    this._syncTransformer();
  }

  // Replaces main.js's old post-construction monkey-patch of
  // selectShape/deselectShape (it needed to reach in from outside
  // specifically to keep the transformer's wrapped nodes in sync, back
  // when there was only ever one selected shape to hand it). Now that
  // selection is a set, this lives here instead, next to the selection
  // state it's keeping in sync, and every selection-changing method
  // goes through it via _afterSelectionChanged rather than each needing
  // its own copy of this logic.
  _syncTransformer() {
    if (!this.transformer) return;
    // A Text node mid-inline-edit (TextManager sets isEditing while its
    // textarea overlay is open) is deliberately excluded: attaching the
    // transformer to it would visually fight with that overlay. This
    // generalizes what was previously a single-shape special case to a
    // filter, since a multi-select could in principle include a shape
    // currently being edited alongside others that aren't. A locked
    // shape (docs/TASKS.md P2-7) is excluded too - "locked objects skip
    // transformer" is this task's own stated requirement, so resize/
    // rotate handles never appear on one even while it's selected
    // (selecting it - to unlock it again - still works; only the
    // transformer attachment is skipped).
    const nodes = this.selection.shapes.filter(
      (shape) =>
        !(shape.getClassName() === "Text" && shape.isEditing) &&
        !shape.getAttr("locked")
    );
    this.transformer.nodes(nodes);
    // A single freshly-created/short Text node's own attrs (e.g. the
    // default 200px width) don't necessarily match its actual rendered
    // bounds, so the transformer needs an explicit override to visually
    // wrap the real text rather than the nominal shape size - only
    // meaningful for exactly one selected Text node; Konva's Transformer
    // already computes its own encompassing box correctly across
    // multiple nodes on its own.
    if (nodes.length === 1 && nodes[0].getClassName() === "Text") {
      const box = nodes[0].getClientRect();
      this.transformer.setAttrs({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
  }

  addShape(shape) {
    this.shapes.push(shape);
    this.mainLayer.add(shape);
    if (this.toolManager) {
      this.toolManager.registerNewShape(shape);
    }
    this.mainLayer.batchDraw();
  }

  removeShape(shape) {
    const index = this.shapes.indexOf(shape);
    if (index > -1) {
      this.shapes.splice(index, 1);
      this.selection.remove(shape);
      shape.destroy();
      this.mainLayer.batchDraw();
      window.eventBus.emit("shapeRemoved");
    }
  }

  // Removes every shape given in one batch - used by multi-select
  // delete/cut (docs/TASKS.md P2-1/P2-4) instead of calling removeShape
  // in a loop, which would emit "shapeRemoved" once per shape and, with
  // it, commit a separate undo checkpoint for each one - so selecting 3
  // shapes and pressing Delete would need 3 presses of Ctrl+Z to bring
  // them all back instead of 1. One emission here means one commit.
  // Returns whether anything was actually removed (docs/TASKS.md P2-7:
  // a selection that's entirely locked shapes removes nothing at all -
  // callers like ui/Shortcuts.js's Delete handler need to know that, so
  // they don't deselect a shape Delete just declined to touch).
  removeShapes(shapes) {
    let removedAny = false;
    shapes.forEach((shape) => {
      // Locked shapes cannot be deleted (docs/TASKS.md P2-7) until
      // unlocked - skipped here rather than by every caller, so a
      // Delete/cut over a mixed locked+unlocked selection still removes
      // whichever of them aren't locked instead of doing nothing at all.
      if (shape.getAttr("locked")) return;
      const index = this.shapes.indexOf(shape);
      if (index > -1) {
        this.shapes.splice(index, 1);
        this.selection.remove(shape);
        shape.destroy();
        removedAny = true;
      } else if (this._isGroupChild(shape)) {
        // A selected child inside an entered group (docs/TASKS.md P2-6):
        // not itself a top-level entry in `this.shapes` - only its
        // parent Group is - so there is no array entry to splice; its
        // parent Group's own children already reflects the live Konva
        // tree, so destroying it is the whole story.
        this.selection.remove(shape);
        shape.destroy();
        removedAny = true;
      }
    });
    if (removedAny) {
      this.mainLayer.batchDraw();
      window.eventBus.emit("shapeRemoved");
    }
    return removedAny;
  }

  _isGroupChild(shape) {
    const parent = shape.getParent?.();
    return (
      !!parent &&
      parent.getClassName() === "Group" &&
      parent.getAttr("toolType") === "group"
    );
  }

  // Arrow-key nudge (docs/TASKS.md P2-5): moves every selected shape by
  // the same (dx, dy) - ui/Shortcuts.js is the one real caller, passing
  // ±1 for a plain arrow or ±10 for Shift+arrow. A no-op with nothing
  // selected. Emits one "shapeNudged" for the whole call, not one per
  // shape, matching removeShapes/paste's single-emission-per-batch
  // reasoning - holding an arrow key down fires this repeatedly, and
  // each call is already its own undo-worthy step (main.js debounces the
  // actual history commit, the same way it already does for a drag's
  // "shapeDragEnded"). "Honours grid when on" (the task's other stated
  // half) is not implemented: this app has no grid/snap feature yet at
  // all (see ui/shortcuts-data.js's own comment for the same exclusion
  // elsewhere) - there is nothing for a nudge to honour today.
  nudgeSelection(dx, dy) {
    // Locked shapes cannot be moved (docs/TASKS.md P2-7) - filtered out
    // rather than bailing out entirely, so nudging a mixed selection
    // still moves whichever shapes aren't locked.
    const shapes = this.selectedShapes.filter((s) => !s.getAttr("locked"));
    if (shapes.length === 0) return;
    shapes.forEach((shape) => {
      shape.position({ x: shape.x() + dx, y: shape.y() + dy });
    });
    this.updateConnections(); // also batchDraws the main layer
    window.eventBus.emit("shapeNudged");
  }

  // Ctrl/Cmd+L (docs/TASKS.md P2-7): toggles the current selection's
  // locked state - a locked shape "cannot be moved, resized or deleted
  // until unlocked" (PRD SEL-3), enforced by nudgeSelection/removeShapes
  // above and _syncTransformer's own filter, plus ToolManager's
  // _setShapePointerMode keeping draggable() in sync with it whenever
  // the tool changes. Selecting a locked shape still works (that's the
  // only way to reach it to unlock again - no object list or context
  // menu exists yet, docs/TASKS.md P2-10/LAY-1, to unlock any other
  // way), so click/drag-selection and the transformer's node-filter are
  // the only two things this task's "skip transformer and drag" title
  // actually needs to skip.
  //
  // A no-op with nothing selected. If every selected shape is already
  // locked, this unlocks them all; otherwise it locks all of them
  // (including any that already were) - the same "not all locked yet ->
  // lock everything, all locked -> unlock everything" convention as
  // design tools like Figma use for a mixed selection, rather than
  // toggling each shape independently of the others (which would leave
  // a single Ctrl+L on a mixed selection producing an equally mixed,
  // confusing result).
  toggleLockSelection() {
    const shapes = this.selectedShapes;
    if (shapes.length === 0) return;
    const nextLocked = !shapes.every((s) => !!s.getAttr("locked"));
    shapes.forEach((shape) => {
      shape.setAttr("locked", nextLocked);
      if (this.toolManager) this.toolManager.registerNewShape(shape);
      else shape.draggable(!nextLocked);
    });
    this._syncTransformer();
    this.mainLayer.batchDraw();
    window.eventBus.emit("shapeLockChanged");
  }

  // Z-order (docs/TASKS.md P2-8): `this.shapes`' own array order is
  // already this app's one source of truth for stacking order
  // (toDocumentObjects/addShape's own comments) - these four just
  // reorder that array, then replay it onto Konva's real paint order via
  // each shape's own moveToTop() (see _reorderSelection's own comment
  // for why not Container.add()). A no-op with nothing selected; each is
  // a single eventBus emission (immediate history commit, like
  // group/lock) regardless of how many shapes move.

  /** Moves every selected shape above everything else, preserving their
   * own relative order to each other. */
  bringToFront() {
    this._reorderSelection((selected, rest, moved) => [...rest, ...moved]);
  }

  /** Moves every selected shape below everything else, preserving their
   * own relative order to each other. */
  sendToBack() {
    this._reorderSelection((selected, rest, moved) => [...moved, ...rest]);
  }

  /** Moves each selected shape up past its nearest unselected neighbor
   * (not past another selected shape) - a contiguous selected block
   * shifts up by one as a whole; a scattered selection has each of its
   * shapes hop its own neighbor independently. */
  bringForward() {
    this._reorderSelection((selected) => {
      const next = [...this.shapes];
      for (let i = next.length - 2; i >= 0; i--) {
        if (selected.has(next[i]) && !selected.has(next[i + 1])) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
      return next;
    });
  }

  /** The mirror of bringForward: each selected shape moves down past its
   * nearest unselected neighbor. */
  sendBackward() {
    this._reorderSelection((selected) => {
      const next = [...this.shapes];
      for (let i = 1; i < next.length; i++) {
        if (selected.has(next[i]) && !selected.has(next[i - 1])) {
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
        }
      }
      return next;
    });
  }

  // Shared tail: `compute(selectedSet, rest, moved)` returns the new
  // `this.shapes` order. `rest`/`moved` (the unselected/selected shapes,
  // each in their own existing z-order - NOT `this.selectedShapes`'
  // selection-insertion order, which is a different thing entirely and
  // would silently reorder a multi-selection's shapes relative to each
  // other, caught by a unit test asserting the *expected* z-order-
  // preserving output before this split existed) are only meaningful
  // for the front/back callers above; forward/backward take just the
  // Set (for its .has() lookups) and compute their result directly from
  // `this.shapes`.
  _reorderSelection(compute) {
    const shapes = this.selectedShapes;
    if (shapes.length === 0) return;
    const selected = new Set(shapes);
    const rest = this.shapes.filter((s) => !selected.has(s));
    const moved = this.shapes.filter((s) => selected.has(s));
    this.shapes = compute(selected, rest, moved);
    // Replays the new order onto Konva's actual paint order - NOT via
    // mainLayer.add(shape): Container.add() delegates to Node.moveTo(),
    // which no-ops whenever the node's parent is already the target
    // container (true for every shape here, since they never leave
    // mainLayer), silently leaving Konva's real child order completely
    // untouched. Node.moveToTop() has no such same-parent guard - it
    // unconditionally splices the node out and re-pushes it - so
    // calling it on every shape in the new array's order rebuilds
    // Konva's own children array to match. Caught by a unit test that
    // checked mainLayer's actual children order, not just
    // `this.shapes` itself (which was already correct either way).
    this.shapes.forEach((shape) => shape.moveToTop());
    this.mainLayer.batchDraw();
    window.eventBus.emit("shapeZOrderChanged");
  }

  /** Copies the current selection's shapes into this app's own in-memory
   * clipboard (see Clipboard.js for why it's not the OS clipboard). A
   * no-op with nothing selected - it does not clear a previous copy. */
  copySelection() {
    if (this.selection.size === 0) return;
    this.clipboard.write(
      this.selectedShapes.map((shape) => this.toStorageShape(shape))
    );
  }

  /** Copies the current selection, then removes it - one removeShapes
   * call, so (like Delete) it commits a single undo checkpoint rather
   * than one per shape. Deselecting still happens *before* removing
   * (detaching the transformer from shapes that are about to be
   * destroyed, rather than after), the same order this always used -
   * only skipped entirely when nothing in the selection is actually
   * removable (docs/TASKS.md P2-7: an entirely-locked selection - it's
   * still been copied - should stay selected rather than being silently
   * deselected for a delete that never happened). */
  cutSelection() {
    if (this.selection.size === 0) return;
    this.copySelection();
    const shapes = this.selectedShapes;
    if (shapes.some((shape) => !shape.getAttr("locked"))) {
      this.deselectShape();
    }
    this.removeShapes(shapes);
  }

  /** Pastes whatever this app's clipboard is currently holding, offset
   * from where it was copied so it doesn't land exactly on top of the
   * original, and selects the newly-pasted shapes. A no-op if nothing
   * has been copied/cut yet. */
  pasteClipboard(offset = CLIPBOARD_OFFSET) {
    const stored = this.clipboard.read();
    if (!stored) return;
    this._instantiateOffset(stored, offset);
  }

  /** Copies the current selection and immediately pastes it back with an
   * offset, without touching the clipboard - so duplicating a shape never
   * clobbers whatever a previous real copy would otherwise paste. */
  duplicateSelection(offset = CLIPBOARD_OFFSET) {
    if (this.selection.size === 0) return;
    const stored = this.selectedShapes.map((shape) =>
      this.toStorageShape(shape)
    );
    this._instantiateOffset(stored, offset);
  }

  // Shared tail of pasteClipboard/duplicateSelection: rebuilds each
  // stored shape with a fresh id and an offset position, waits for every
  // one of them to actually land (reconstructShapes' onSettled - Image
  // shapes load asynchronously, everything else is synchronous, and
  // mixing the two is exactly why onSettled counts rather than assuming
  // reconstructShapes is done when it returns), then selects the whole
  // pasted/duplicated batch and emits a single "shapeAdded" - one undo
  // checkpoint for the whole paste, the same reasoning as removeShapes'
  // single "shapeRemoved" above.
  _instantiateOffset(storedShapes, offset) {
    if (storedShapes.length === 0) return;
    const objects = storedShapes.map((stored) => ({
      type: stored.type,
      attrs: {
        ...stored.attrs,
        id: createId(),
        x: (stored.attrs.x ?? 0) + offset.x,
        y: (stored.attrs.y ?? 0) + offset.y,
      },
    }));
    const landed = [];
    let settled = 0;
    const finish = () => {
      if (landed.length > 0) this.selectShapes(landed);
      window.eventBus.emit("shapeAdded");
    };
    this.reconstructShapes(objects, {
      onSettled: (shape) => {
        if (shape) landed.push(shape);
        settled += 1;
        if (settled === objects.length) finish();
      },
    });
  }

  // Bridge to the core/Document.js v2 schema (docs/TASKS.md P1-1). Kept
  // here rather than in Document.js itself, which is deliberately
  // Konva-agnostic: this is the one place that knows how to walk live
  // Konva nodes, and it reuses toStorageShape/reconstructShapes (already
  // covered by their own tests) rather than duplicating their per-type
  // logic. zIndex comes from array position, the same source of truth
  // addShape has always used for stacking order.
  toDocumentObjects() {
    return this.shapes.map((shape, index) => {
      const stored = this.toStorageShape(shape);
      return {
        id: stored.attrs.id || shape.id() || createId("obj"),
        type: stored.type,
        zIndex: index,
        attrs: stored.attrs,
      };
    });
  }

  // Accepts document.objects (docs/TASKS.md P1-1's schema: unordered is
  // fine, each carries its own zIndex) rather than requiring the caller
  // to have already sorted them.
  loadDocumentObjects(objects) {
    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    this.reconstructShapes(
      sorted.map((obj) => ({
        type: obj.type,
        attrs: { ...obj.attrs, id: obj.attrs.id || obj.id },
      }))
    );
  }

  // Import (docs/TASKS.md P1-7) merge mode: adds another document's
  // objects onto the current canvas without removing what's already
  // there (unlike loadDocumentObjects, which is a full replace). Any
  // incoming id that collides with a shape already on the canvas is
  // replaced with a fresh one - two independently-exported documents
  // have no reason to share an id, and a duplicate would break
  // id-based lookups like updateConnections' shape.id() === connection.from
  // scans. The incoming objects are still sorted by their own zIndex
  // first so their relative order is preserved; reconstructShapes/
  // addShape then appends them after everything already on the canvas,
  // which becomes their new stacking position (toDocumentObjects always
  // derives zIndex from array position, not a stored field).
  mergeDocumentObjects(objects) {
    const existingIds = new Set(this.shapes.map((shape) => shape.id()));
    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    this.reconstructShapes(
      sorted.map((obj) => {
        const incomingId = obj.attrs.id || obj.id;
        const id =
          incomingId && !existingIds.has(incomingId)
            ? incomingId
            : createId("obj");
        return { type: obj.type, attrs: { ...obj.attrs, id } };
      })
    );
  }

  // Builds one of the plain synchronous shape types from its stored
  // {type, attrs} - the common construction reconstructShapes' own
  // switch below uses for a top-level shape, and the only kind of child
  // a real Group (docs/TASKS.md P2-6) can contain (see
  // GROUPABLE_CLASS_NAMES). Returns the raw Konva node with no event
  // wiring and nothing added anywhere yet - purely construction, so the
  // caller decides whether it becomes a top-level shape or a group
  // child, which need different event wiring (setupShapeEvents/
  // setupTextEvents vs _setupGroupChildEvents). Returns null for any
  // other type - StickyNote/Image/Group all need their own construction
  // (StickyNote/Group build a whole node tree; Image loads
  // asynchronously), so they stay directly in reconstructShapes' switch
  // rather than trying to force them through here too.
  _buildSimpleShape(type, attrs) {
    switch (type) {
      case "Circle":
        return new Circle(attrs);
      case "Rect":
        return new Rect(attrs);
      case "Line":
        return new Line(attrs);
      case "RegularPolygon":
        return new RegularPolygon(attrs);
      case "Star":
        return new Star(attrs);
      case "Text":
        return new Text({
          ...attrs,
          draggable: true,
          width: attrs.width || 200,
          padding: attrs.padding || 5,
        });
      default:
        return null;
    }
  }

  // `onSettled(shape | null)` (docs/TASKS.md P2-4) fires exactly once per
  // input object, in the same order for the synchronous types but not
  // necessarily for Image (its fromURL load is async, so it can settle
  // after later synchronous entries already have) - null means the
  // object produced no shape (unknown type, or an Image with neither
  // iconFile nor imageSrc). Every existing caller (load, import's merge,
  // undo/redo's applyCanvasSnapshot) omits it and is unaffected; paste/
  // duplicate (below) use it to know when every pasted object - Image's
  // async ones included - has actually landed, so they select the whole
  // pasted batch and commit one history checkpoint only once, not one at
  // a time as each shape happens to finish.
  reconstructShapes(shapes, { onSettled } = {}) {
    shapes.forEach((shapeData) => {
      let shape;
      const type = shapeData.type;
      const attrs = shapeData.attrs;
      switch (type) {
        case "Circle":
        case "Rect":
        case "Line":
        case "RegularPolygon":
        case "Star":
          shape = this._buildSimpleShape(type, attrs);
          break;
        case "Text":
          shape = this._buildSimpleShape(type, attrs);
          if (this.textManager) {
            this.textManager.setupTextEvents(shape);
          }
          break;
        case "Group": {
          // A real group (docs/TASKS.md P2-6). Each child comes from
          // _buildSimpleShape - the only types groupSelection ever put
          // in here in the first place (GROUPABLE_CLASS_NAMES) - wired
          // with _setupGroupChildEvents instead of the generic top-level
          // setupShapeEvents/setupTextEvents, same as a freshly grouped
          // shape gets. An unrecognized child type (hand-edited JSON,
          // or a future format this version predates) is silently
          // dropped rather than treated as fatal - the rest of the
          // group, and the rest of the document, still loads.
          const group = new Group({
            id: attrs.id || createId(),
            x: attrs.x ?? 0,
            y: attrs.y ?? 0,
            rotation: attrs.rotation ?? 0,
            scaleX: attrs.scaleX ?? 1,
            scaleY: attrs.scaleY ?? 1,
            opacity: attrs.opacity ?? 1,
            name: attrs.name || "Group",
            toolType: "group",
            locked: attrs.locked ?? false,
            draggable: true,
          });
          (attrs.children || []).forEach((childData) => {
            const child = this._buildSimpleShape(
              childData.type,
              childData.attrs
            );
            if (!child) return;
            child.draggable(false);
            this._setupGroupChildEvents(child, group);
            group.add(child);
          });
          this.setupShapeEvents(group, "Group");
          this.addShape(group);
          onSettled?.(group);
          return;
        }
        case "StickyNote": {
          const rectAttrs = attrs.rect || {};
          const textAttrs = attrs.text || {};
          const group = new Group({
            id: attrs.id || createId(),
            x: attrs.x ?? 0,
            y: attrs.y ?? 0,
            rotation: attrs.rotation ?? 0,
            scaleX: attrs.scaleX ?? 1,
            scaleY: attrs.scaleY ?? 1,
            opacity: attrs.opacity ?? 1,
            name: attrs.name || "Note",
            toolType: "sticky",
            locked: attrs.locked ?? false,
            draggable: true,
          });
          const rectNode = new Rect({
            width: 200,
            height: 140,
            ...rectAttrs,
          });
          const { text: noteText, ...textRest } = textAttrs;
          const textNode = new Text({
            x: 10,
            y: 10,
            width: 180,
            fontSize: 14,
            fontFamily: "Poppins",
            fill: "#333333",
            ...textRest,
            text: noteText || "Double click to edit",
          });
          group.add(rectNode);
          group.add(textNode);
          if (this.textManager) {
            this.textManager.setupStickyNote(group);
          }
          this.setupShapeEvents(group, "StickyNote");
          this.addShape(group);
          onSettled?.(group);
          return;
        }
        case "Image": {
          // Prefer the relative iconFile key (current format). Fall back
          // to the legacy absolute svgUrl saved by older versions of
          // this app: the folder convention (assets/svgs/<file>) never
          // changed, so the basename of that stale URL still identifies
          // the right icon even though the full URL (baked to whatever
          // origin/path was live when it was saved) is not directly
          // usable. This keeps pre-fix saved drawings loadable rather
          // than silently dropping those shapes. imageSrc (docs/TASKS.md
          // P2-4) is the other possible source: a self-contained data:
          // URL for an image pasted from the system clipboard, with no
          // bundled asset file to fall back to at all.
          const iconFile =
            attrs.iconFile || (attrs.svgUrl || "").split("/").pop() || "";
          const imageSrc = !iconFile ? attrs.imageSrc || "" : "";
          if (!iconFile && !imageSrc) break;
          const url = iconFile ? `assets/svgs/${iconFile}` : imageSrc;
          Konva.Image.fromURL(
            url,
            (image) => {
              image.setAttrs({
                id: attrs.id || createId(),
                x: attrs.x,
                y: attrs.y,
                width: attrs.width,
                height: attrs.height,
                rotation: attrs.rotation || 0,
                scaleX: attrs.scaleX ?? 1,
                scaleY: attrs.scaleY ?? 1,
                opacity: attrs.opacity ?? 1,
                name: attrs.name || "",
                locked: attrs.locked ?? false,
                draggable: true,
                ...(iconFile ? { iconFile } : { imageSrc }),
              });
              this.setupShapeEvents(image, iconFile ? "SVG" : "Image");
              this.addShape(image);
              onSettled?.(image);
            },
            () => {
              console.warn(
                iconFile
                  ? `FrameX: could not load saved icon "${iconFile}" ` +
                      `(from ${url}); the shape was dropped from the ` +
                      `restored canvas.`
                  : "FrameX: could not load a pasted image; the shape " +
                      "was dropped from the restored canvas."
              );
              onSettled?.(null);
            }
          );
          return;
        }
        default:
          break;
      }
      if (shape) {
        this.setupShapeEvents(shape, type);
        this.addShape(shape);
      }
      onSettled?.(shape || null);
    });
  }

  // The single, canonical event wiring for every shape type (basic
  // shapes, freehand strokes, sticky notes, SVG icons all funnel through
  // here - see ShapeManager, ToolManager and SVGManager). Do not
  // maintain a second copy of this elsewhere: a duplicated copy in
  // ShapeManager (removed in docs/TASKS.md P0-10) was missing the
  // dragend -> "shapeDragEnded" emission below, so dragging any basic
  // shape (circle, rect, square, triangle, star, line - i.e. anything
  // created from the shapes menu) never committed a history checkpoint
  // for its new position; pressing Ctrl+Z after such a drag undid the
  // shape's *creation* instead of just its move, deleting it outright.
  setupShapeEvents(shape, name) {
    // Shift-click toggles this one shape's membership without touching
    // the rest of the selection (docs/TASKS.md P2-1); a plain click
    // replaces the whole selection with just this shape, same as
    // before multi-select existed. Konva only fires "click" when the
    // pointer didn't move between down and up - an actual drag never
    // reaches here, so this can't misfire mid-drag.
    shape.on("click", (e) => {
      if (e.evt?.shiftKey) {
        window.eventBus.emit("shapeToggled", shape);
      } else {
        window.eventBus.emit("shapeSelected", shape);
      }
    });

    shape.on("mouseover", () => {
      this.updateTooltip(name, shape.x(), shape.y());
    });

    shape.on("mouseout", () => {
      this.hideTooltip();
    });

    // Dragging any one shape that's part of a multi-shape selection
    // already moves the whole selection together, for free: Konva's
    // own Transformer (docs/TASKS.md P2-1's _syncTransformer keeps it
    // wrapping every selected node) implements exactly this via its
    // internal _proxyDrag - wired the moment a node is passed to
    // transformer.nodes([...]), which _syncTransformer already does on
    // every selection change. An earlier version of this method
    // duplicated that logic by hand (tracking each selected shape's
    // drag-start position and re-applying the same delta), which
    // fought with the Transformer's own built-in handling of the exact
    // same drag and compounded into visibly wrong movement - caught by
    // a Playwright-driven real mouse drag in e2e/selection.spec.js
    // landing shapes tens of pixels off from where the mouse actually
    // went, not by reasoning about Konva's internals up front.
    shape.on("dragmove", () => {
      this.mainLayer.batchDraw();
      this.updateConnections();
      this.hideTooltip();
    });

    shape.on("dragend", () => {
      window.eventBus.emit("shapeDragEnded");
    });

    // Double-click "enters" a real group (docs/TASKS.md P2-6) so a later
    // plain click on one of its children selects that child instead of
    // the whole group - see _exitGroupUnless for how/when this clears
    // again. Gated to toolType "group" specifically (not "sticky", the
    // other Group-className shape this app has): a sticky note isn't
    // the group/ungroup feature's group, and double-clicking one already
    // means "edit its text" (TextManager.setupStickyNote's own
    // dblclick), not "enter it". Harmless no-op for every non-group
    // shape - Circle/Rect/etc. simply have no reason to ever match.
    shape.on("dblclick", () => {
      if (
        shape.getClassName() === "Group" &&
        shape.getAttr("toolType") === "group"
      ) {
        this._enteredGroup = shape;
      }
    });
  }

  // Wiring for a shape that has become a group's child (docs/TASKS.md
  // P2-6), deliberately NOT the same as setupShapeEvents above: a click
  // on a group child means "select the group" while that group isn't
  // entered, or "select this one child" once it is - StickyNote already
  // established this same click-redirect idea for its own fixed two-
  // child case (TextManager.setupStickyNote); this generalizes it to an
  // arbitrary group. `child.off()` first strips whatever wiring the
  // shape had before (its own top-level setupShapeEvents/setupTextEvents,
  // or an earlier group's child wiring if it's being re-grouped) so
  // nothing double-fires.
  _setupGroupChildEvents(child, group) {
    child.off();

    child.on("click", (e) => {
      e.cancelBubble = true;
      if (this._enteredGroup === group) {
        if (e.evt?.shiftKey) {
          window.eventBus.emit("shapeToggled", child);
        } else {
          window.eventBus.emit("shapeSelected", child);
        }
      } else if (e.evt?.shiftKey) {
        window.eventBus.emit("shapeToggled", group);
      } else {
        window.eventBus.emit("shapeSelected", group);
      }
    });

    // A grouped Text child keeps its inline-edit capability, but only
    // once the group is entered - the first double-click enters the
    // group (bubbling up to setupShapeEvents' own dblclick handler,
    // since this doesn't set cancelBubble in that case), a second
    // double-click while entered opens the editor.
    if (child.getClassName() === "Text" && this.textManager) {
      child.on("dblclick", (e) => {
        if (this._enteredGroup === group) {
          e.cancelBubble = true;
          this.textManager.startEditing(child);
        }
      });
    }

    child.on("mouseover", () => {
      this.updateTooltip(child.getAttr("name") || "", child.x(), child.y());
    });
    child.on("mouseout", () => {
      this.hideTooltip();
    });
  }

  // Ctrl/Cmd+G (docs/TASKS.md P2-6): folds every selected shape into one
  // new Group, which then behaves as a single object - one click selects
  // the whole thing, one drag/resize/rotate moves them all together
  // (Konva's Transformer already does this generically for any node,
  // group included). A no-op unless there are at least 2 selected shapes
  // that are (a) all groupable types (GROUPABLE_CLASS_NAMES) and (b) all
  // already top-level entries in `this.shapes` - not, say, a mix that
  // includes another group's own child, which a shift-click across an
  // entered group and the wider canvas can otherwise produce.
  groupSelection() {
    const shapes = this.selectedShapes;
    if (shapes.length < 2) return;
    if (shapes.some((s) => !this.shapes.includes(s))) return;
    if (shapes.some((s) => !GROUPABLE_CLASS_NAMES.has(s.getClassName())))
      return;

    // Keep the grouped shapes' own relative stacking order, and give the
    // new group the lowest of their zIndex positions - grouping
    // shouldn't visibly jump the result to the front just because it's
    // new, the same way toDocumentObjects/addShape already treat array
    // position as the source of truth for z-order everywhere else.
    const ordered = this.shapes.filter((s) => shapes.includes(s));
    const insertIndex = this.shapes.indexOf(ordered[0]);

    this._groupCount += 1;
    const group = new Group({
      id: createId(),
      x: 0,
      y: 0,
      name: `Group ${this._groupCount}`,
      toolType: "group",
      draggable: true,
    });

    ordered.forEach((shape) => {
      const index = this.shapes.indexOf(shape);
      this.shapes.splice(index, 1);
      shape.draggable(false);
      this._setupGroupChildEvents(shape, group);
      group.add(shape); // Konva reparents automatically
    });

    this.mainLayer.add(group);
    this.shapes.splice(insertIndex, 0, group);
    if (this.toolManager) this.toolManager.registerNewShape(group);
    this.setupShapeEvents(group, "Group");
    this.selectShape(group);
    this.mainLayer.batchDraw();
    // Reuses "shapeAdded" (docs/TASKS.md P2-1's removeShapes/P2-4's
    // paste already established the pattern of reusing these two events
    // for "the top-level shape list changed structurally", not only for
    // a literal single new shape) - a new top-level object, the group,
    // was added.
    window.eventBus.emit("shapeAdded");
  }

  // Ctrl/Cmd+Shift+G (docs/TASKS.md P2-6): the inverse of groupSelection.
  // A no-op unless the selection is exactly one real group (toolType
  // "group" - not a sticky note, which is also a Group but isn't this
  // feature's group). Each child's current *absolute* position/rotation/
  // scale (which already accounts for whatever the group itself was
  // moved/rotated/resized to) is baked into its own attrs before it's
  // reparented to the main layer directly (identity transform), so
  // ungrouping never visibly moves anything - the same way Illustrator/
  // Figma's own ungroup preserves appearance rather than resetting each
  // child back to its pre-group transform.
  ungroupSelection() {
    const group = this.selectedShape;
    if (
      this.selection.size !== 1 ||
      !group ||
      group.getClassName() !== "Group" ||
      group.getAttr("toolType") !== "group"
    ) {
      return;
    }

    const groupIndex = this.shapes.indexOf(group);
    // getChildren() returns the group's own live backing array, which
    // reparenting (mainLayer.add(child) below) mutates in place - mapping
    // over it directly would skip children as the array shrinks out from
    // under the iteration, so a plain snapshot copy goes first.
    const children = [...group.getChildren()];
    const restored = children.map((child) => {
      const absPos = child.getAbsolutePosition();
      const absRotation = child.getAbsoluteRotation();
      const absScale = child.getAbsoluteScale();

      child.off();
      this.mainLayer.add(child);
      child.position(absPos);
      child.rotation(absRotation);
      child.scale(absScale);
      child.draggable(true);

      // Text shapes are wired via TextManager.setupTextEvents at the top
      // level, never CanvasManager.setupShapeEvents directly - see
      // reconstructShapes' own "Text" case for the same split.
      if (child.getClassName() === "Text" && this.textManager) {
        this.textManager.setupTextEvents(child);
      } else {
        this.setupShapeEvents(
          child,
          child.getAttr("name") || child.getClassName()
        );
      }
      if (this.toolManager) this.toolManager.registerNewShape(child);
      return child;
    });

    this.shapes.splice(groupIndex, 1, ...restored);
    this.selection.clear();
    this._enteredGroup = null;
    group.destroy();
    this.selectShapes(restored);
    this.mainLayer.batchDraw();
    // Reuses "shapeRemoved" - see groupSelection's own comment on why
    // that's the right existing signal to reuse rather than a new event,
    // even though former children reappear as top-level shapes in the
    // same step: the meaningful structural change is that the group's
    // own top-level entry is gone.
    window.eventBus.emit("shapeRemoved");
  }

  // Minimal hover tooltip on the dedicated tooltipLayer (already created
  // and passed in by main.js, but previously unused: SVGManager called
  // these two methods on every icon mouseover/mouseout, and since they
  // did not exist, hovering an SVG icon threw a TypeError. That code
  // path was unreachable in production until this same change fixed
  // the icon build/persistence pipeline (docs/TASKS.md P0-3), which is
  // why the crash was never observed in practice.
  updateTooltip(text, x, y) {
    if (!this.tooltipLayer) return;
    this.hideTooltip();
    const label = new Konva.Label({
      x: x + 12,
      y: y - 12,
      listening: false,
    });
    label.add(
      new Konva.Tag({
        fill: "#1f2937",
        cornerRadius: 4,
        pointerDirection: "left",
        pointerWidth: 6,
        pointerHeight: 6,
        shadowColor: "black",
        shadowBlur: 4,
        shadowOpacity: 0.2,
      })
    );
    label.add(
      new Konva.Text({
        text: text || "",
        fontFamily: "Poppins, sans-serif",
        fontSize: 12,
        padding: 6,
        fill: "#ffffff",
      })
    );
    this._tooltipLabel = label;
    this.tooltipLayer.add(label);
    this.tooltipLayer.batchDraw();
  }

  hideTooltip() {
    if (this._tooltipLabel) {
      this._tooltipLabel.destroy();
      this._tooltipLabel = null;
      this.tooltipLayer?.batchDraw();
    }
  }

  updateConnections() {
    this.connections.forEach((connection) => {
      const fromShape = this.shapes.find((s) => s.id() === connection.from);
      const toShape = this.shapes.find((s) => s.id() === connection.to);

      if (fromShape && toShape) {
        const points = this.getConnectionPoints(fromShape, toShape);
        connection.line.points(points);
      }
    });
    this.mainLayer.batchDraw();
  }

  getConnectionPoints(fromShape, toShape) {
    const fromCenter = {
      x: fromShape.x() + fromShape.width() / 2,
      y: fromShape.y() + fromShape.height() / 2,
    };
    const toCenter = {
      x: toShape.x() + toShape.width() / 2,
      y: toShape.y() + toShape.height() / 2,
    };

    return [fromCenter.x, fromCenter.y, toCenter.x, toCenter.y];
  }

  clearCanvas() {
    this.shapes.forEach((shape) => shape.destroy());
    this.shapes = [];
    this.connections = [];
    // Previously left dangling: the selection (in the pre-multi-select
    // days, just `selectedShape`) kept pointing at an already-destroyed
    // node after Clear Canvas if anything was selected first - never
    // observed as a crash only because nothing happened to read it
    // again before the next real selection change, but multi-select
    // code (_syncTransformer, group-drag) does read the selection on
    // essentially every interaction, so a stale reference here is worth
    // closing now rather than waiting to see it fail.
    this.selection.clear();
    this._enteredGroup = null; // same dangling-reference reasoning as above
    this._syncTransformer();
    this.mainLayer.batchDraw();
  }
}

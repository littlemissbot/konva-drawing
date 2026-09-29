/**
 * In-memory clipboard for copy/cut/paste/duplicate (docs/TASKS.md P2-4).
 * Deliberately NOT the OS clipboard: browsers have no clipboard format for
 * an arbitrary shape, so cross-app copy of a FrameX shape was never a
 * realistic goal here - copy/paste within (or between tabs of) this app
 * only ever needs to survive in memory. The OS clipboard is still used,
 * separately, for pasting an actual image or plain text a user copied
 * from somewhere else (see main.js's "paste" listener and
 * ShapeManager.createImageFromDataUrl/TextManager.createText) - that path
 * doesn't go through this class at all.
 *
 * Holds plain storage-shape objects (CanvasManager.toStorageShape's own
 * output shape: {type, attrs}), the same JSON-safe format already used
 * for save/load and JSON export/import, so this class stays Konva-
 * agnostic like Selection.js and Marquee.js.
 */
export class Clipboard {
  constructor() {
    this._items = null;
  }

  /** True once something has been copied or cut - lets a caller (the
   * "paste" listener) prefer this app's own clipboard over the OS
   * clipboard's content when both could apply. */
  get hasContent() {
    return Array.isArray(this._items) && this._items.length > 0;
  }

  /** Stores a fresh, independent copy of `items` (deep-cloned so neither
   * the caller's live objects nor a later read()'s output can mutate what
   * paste sees next time). */
  write(items) {
    this._items = items.map((item) => JSON.parse(JSON.stringify(item)));
  }

  /** Returns a fresh, independent copy of what was last written, or null
   * if nothing has been copied/cut yet. Each call - e.g. pasting the same
   * clipboard twice - gets its own clone, safe to mutate (new ids, an
   * offset) without corrupting what a later paste would read. */
  read() {
    if (!this._items) return null;
    return this._items.map((item) => JSON.parse(JSON.stringify(item)));
  }

  clear() {
    this._items = null;
  }
}

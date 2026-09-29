/**
 * The multi-select set (docs/TASKS.md P2-1). Deliberately Konva-agnostic
 * - it only ever holds object references and never reaches into a
 * shape's own API - the same reasoning as core/Document.js staying
 * framework-free: it's the one place that knows "what is selected",
 * not how a selected thing behaves, so it needs no jsdom/canvas mocking
 * to unit test and nothing here couples to Konva ever changing.
 *
 * A JS Set (not an array) is the backing store so add/remove/has are
 * O(1) and membership is naturally deduplicated - shift-clicking the
 * same shape twice toggles it, it can never appear twice.
 */
export class Selection {
  constructor() {
    this._shapes = new Set();
  }

  get size() {
    return this._shapes.size;
  }

  /** A fresh array snapshot, safe for a caller to iterate while this
   * selection itself changes (e.g. deleting every selected shape, which
   * removes each one from this same set as it goes). */
  get shapes() {
    return [...this._shapes];
  }

  /** The "most relevant" single shape for single-shape UI (the
   * properties panel's fields, export's selection-only mode when
   * driven by a shortcut rather than a marquee) - the most recently
   * added, i.e. the last one a user clicked/shift-clicked. `null` when
   * nothing is selected. Iteration order of a JS Set is insertion
   * order, so this is just the last entry, not a separately tracked
   * field. */
  get primary() {
    if (this._shapes.size === 0) return null;
    let last;
    for (const shape of this._shapes) last = shape;
    return last;
  }

  has(shape) {
    return this._shapes.has(shape);
  }

  /** Replaces the whole selection with just this one shape. */
  selectOnly(shape) {
    this._shapes = new Set([shape]);
  }

  /** Replaces the whole selection with every shape given (Ctrl+A,
   * marquee select). */
  set(shapes) {
    this._shapes = new Set(shapes);
  }

  /** Adds without affecting the rest of the selection - not used by
   * shift-click (which toggles - see `toggle`) but kept as its own
   * method for marquee-select (docs/TASKS.md P2-2), which unions newly
   * enclosed shapes into whatever was already selected when Shift is
   * held during the drag. */
  add(shape) {
    this._shapes.add(shape);
  }

  remove(shape) {
    this._shapes.delete(shape);
  }

  /** Shift-click: in the selection -> out, out -> in. */
  toggle(shape) {
    if (this._shapes.has(shape)) {
      this._shapes.delete(shape);
    } else {
      this._shapes.add(shape);
    }
  }

  clear() {
    this._shapes.clear();
  }
}

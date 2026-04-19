/**
 * Snapshot-based undo/redo for the canvas (same JSON shape as localStorage).
 */
export class HistoryManager {
  constructor({ getSnapshot, applySnapshot, maxStates = 50 }) {
    this.getSnapshot = getSnapshot;
    this.applySnapshot = applySnapshot;
    this.maxStates = maxStates;
    this.states = [];
    this.ptr = -1;
    this.restoring = false;
  }

  reset(snapshotJson = null) {
    const snap = snapshotJson ?? this.getSnapshot();
    this.states = [snap];
    this.ptr = 0;
    this._updateToolbar();
  }

  commit() {
    if (this.restoring) return;
    const snap = this.getSnapshot();
    if (this.ptr >= 0 && snap === this.states[this.ptr]) return;
    this.states = this.states.slice(0, this.ptr + 1);
    this.states.push(snap);
    this.ptr = this.states.length - 1;
    if (this.states.length > this.maxStates) {
      const overflow = this.states.length - this.maxStates;
      this.states = this.states.slice(overflow);
      this.ptr = this.states.length - 1;
    }
    this._updateToolbar();
  }

  undo() {
    if (this.ptr <= 0) return;
    this.ptr -= 1;
    this._apply(this.states[this.ptr]);
  }

  redo() {
    if (this.ptr >= this.states.length - 1) return;
    this.ptr += 1;
    this._apply(this.states[this.ptr]);
  }

  _apply(json) {
    this.restoring = true;
    try {
      this.applySnapshot(json);
    } finally {
      this.restoring = false;
    }
    this._updateToolbar();
  }

  _updateToolbar() {
    const undoBtn = document.getElementById("undoTool");
    const redoBtn = document.getElementById("redoTool");
    const canUndo = this.ptr > 0;
    const canRedo = this.ptr < this.states.length - 1;
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
  }
}

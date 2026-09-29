/**
 * Saves and loads the current document. Debounces writes, shows a
 * "saving" status as soon as a change happens (not only once the
 * debounce fires - matching the app's existing autosave UX), falls
 * back to IndexedDB when localStorage's quota is exceeded, and reports
 * status through a callback rather than touching the DOM itself (that
 * stays main.js's job, via showSaveStatus()).
 *
 * A single document is all this app has (docs/PRD.md's multi-document
 * DOC-4 is Phase 8), so both backends store it under one fixed key -
 * no per-document addressing yet, and so no need for a document index
 * to keep in sync with it (the PRD's "write to a temp key, then
 * rename" language is aimed at that future multi-key case; a single
 * localStorage.setItem() to one key is already atomic - the browser
 * either commits the whole string or throws, there is no partially-
 * written state to protect against here, and a temp-key/rename dance
 * around a single key would add a second write with its own failure
 * window rather than remove one).
 */

import { STORAGE_KEY, parseDocument } from "./Document.js";

const DB_NAME = "framex";
const DB_VERSION = 1;
const STORE_NAME = "documents";
// Only one document lives in IndexedDB today, for the same single-
// document reason as the fixed localStorage key above.
const IDB_KEY = "current";

function isQuotaExceededError(e) {
  // DOMException.name is "QuotaExceededError" in every evergreen
  // browser; older Firefox used numeric code 1014. Checking both is
  // cheap and avoids missing the one case this fallback exists for.
  return (
    e &&
    (e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e.code === 1014)
  );
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(value) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(IDB_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete() {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export class Persistence {
  /**
   * @param {object} [options]
   * @param {number} [options.debounceMs] delay between the last change
   *   and the actual write; each new call restarts the timer.
   * @param {number} [options.maxWaitMs] a write happens no later than
   *   this long after the *first* change in a burst, even if changes
   *   keep arriving and would otherwise keep resetting debounceMs
   *   forever (e.g. a long continuous drag). Must be >= debounceMs to
   *   have any effect.
   * @param {(status: {state: "saving"|"saved"|"failed", error?: Error, backend?: string}) => void} [options.onStatusChange]
   */
  constructor({
    debounceMs = 2000,
    maxWaitMs = 10000,
    onStatusChange = () => {},
  } = {}) {
    this.debounceMs = debounceMs;
    this.maxWaitMs = maxWaitMs;
    this.onStatusChange = onStatusChange;
    this._timer = null;
    this._pendingDocument = null;
    this._saving = false;
    this._lastWrittenJson = null;
    this._firstPendingAt = null;
  }

  /**
   * Debounced save: call on every change. Emits "saving" immediately on
   * the first call since the last successful save (so the UI shows
   * "Saving..." right away, not just after the debounce elapses),
   * regardless of how many more times it is called before the debounce
   * fires. The actual write happens debounceMs after the last call, or
   * maxWaitMs after the first call in the current burst, whichever
   * comes first - continuous activity delays the debounce but cannot
   * defer a write forever.
   */
  scheduleSave(document) {
    this._pendingDocument = document;
    if (!this._saving) {
      this._saving = true;
      this._firstPendingAt = Date.now();
      this.onStatusChange({ state: "saving" });
    }
    if (this._timer) clearTimeout(this._timer);
    const elapsedSinceFirst = Date.now() - this._firstPendingAt;
    const delay = Math.min(
      this.debounceMs,
      Math.max(0, this.maxWaitMs - elapsedSinceFirst)
    );
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, delay);
  }

  /** True from the moment a change is scheduled until it has actually
   * been written (to either backend) or has failed. Lets a caller (the
   * app's beforeunload handler) warn about unsaved changes without
   * reaching into this class's private fields. */
  get isSaving() {
    return this._saving;
  }

  /** Writes immediately, skipping the debounce. Used before an action
   * that needs the save to have actually happened first, e.g. clearing
   * the canvas or the user closing the tab. */
  async saveNow(document) {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pendingDocument = document;
    await this._flush();
  }

  async _flush() {
    const document = this._pendingDocument;
    if (document === null) return;
    const json = JSON.stringify(document);
    if (json === this._lastWrittenJson) {
      // Nothing actually changed since the last successful write (e.g.
      // scheduleSave was called from a handler that fires on selection
      // as well as real edits); skip the write but still clear the
      // "saving" state so the status settles back to "saved".
      this._saving = false;
      this.onStatusChange({ state: "saved", backend: this._lastBackend });
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, json);
      this._lastWrittenJson = json;
      this._lastBackend = "localStorage";
      this._saving = false;
      this.onStatusChange({ state: "saved", backend: "localStorage" });
      return;
    } catch (e) {
      if (!isQuotaExceededError(e)) {
        // Not a quota problem (localStorage disabled, private-browsing
        // restrictions, etc.) - IndexedDB may still work, so fall
        // through to it rather than giving up immediately.
        console.warn(
          "FrameX: localStorage.setItem failed, trying IndexedDB:",
          e
        );
      }
    }

    try {
      await idbPut(json);
      this._lastWrittenJson = json;
      this._lastBackend = "indexeddb";
      this._saving = false;
      this.onStatusChange({ state: "saved", backend: "indexeddb" });
    } catch (idbError) {
      this._saving = false;
      this.onStatusChange({ state: "failed", error: idbError });
    }
  }

  /**
   * Loads the current document: localStorage first (the common case),
   * then IndexedDB (in case an earlier save fell back there). Returns
   * `{ document: null, migrated: false, backend: null }` if nothing has
   * ever been saved. Throws SyntaxError or DocumentValidationError (see
   * Document.js) if what was saved is corrupt - the caller decides how
   * to surface that; this does not swallow it into a null return, since
   * "nothing saved" and "something saved but unreadable" are different
   * situations a user should be told apart.
   */
  async load() {
    const fromLocalStorage = localStorage.getItem(STORAGE_KEY);
    if (fromLocalStorage) {
      const { document, migrated } = parseDocument(fromLocalStorage);
      this._lastWrittenJson = JSON.stringify(document);
      this._lastBackend = "localStorage";
      return { document, migrated, backend: "localStorage" };
    }

    let fromIdb = null;
    try {
      fromIdb = await idbGet();
    } catch {
      // IndexedDB unavailable/broken and localStorage had nothing:
      // nothing to load, not an error - same as the "never saved" case.
    }
    if (fromIdb) {
      const { document, migrated } = parseDocument(fromIdb);
      this._lastWrittenJson = JSON.stringify(document);
      this._lastBackend = "indexeddb";
      return { document, migrated, backend: "indexeddb" };
    }

    return { document: null, migrated: false, backend: null };
  }

  /** Removes the saved document from both backends (used by Clear
   * Canvas) and resets dedupe/debounce state so the next scheduleSave
   * is treated as a real change rather than a no-op repeat. */
  async clear() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pendingDocument = null;
    this._saving = false;
    this._lastWrittenJson = null;
    this._lastBackend = null;
    localStorage.removeItem(STORAGE_KEY);
    try {
      await idbDelete();
    } catch {
      // Nothing was necessarily there to delete; not an error.
    }
  }
}

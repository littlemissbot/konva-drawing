/**
 * JSON export and import (docs/TASKS.md P1-7): the same v2 document
 * core/Persistence.js saves to localStorage/IndexedDB, but as a file that
 * can leave the browser entirely - backed up, emailed, moved to another
 * machine - and brought back in exactly as saved. Reuses
 * core/Document.js's own parseDocument() for the import side (JSON
 * parsing, v1-save migration, schema validation) rather than duplicating
 * any of it here; this module only adds the parts specific to a real
 * file: turning a document into downloadable bytes, and reading an
 * uploaded/dropped File back into one.
 */

import { parseDocument } from "../core/Document.js";

export function serializeDocument(document) {
  return JSON.stringify(document, null, 2);
}

export function exportJsonBlob(document) {
  return new Blob([serializeDocument(document)], {
    type: "application/json",
  });
}

/** A safe, human-recognizable filename derived from the document's own
 * name, falling back to "Untitled" for an empty/whitespace-only name or
 * one that sanitizes down to nothing (e.g. a name made entirely of
 * punctuation). The `.framex.json` double extension keeps it a `.json`
 * file (openable, inspectable, importable by anything) while still
 * being recognizable as this app's own export, not just generic JSON. */
export function suggestedFilename(document) {
  const sanitized = (document?.name || "")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${sanitized || "Untitled"}.framex.json`;
}

/**
 * Reads a File/Blob (from a file input or a drag-and-drop event) as a
 * FrameX document, migrating a legacy v1 save the same way
 * Persistence.load() does.
 *
 * @param {File|Blob} file
 * @returns {Promise<{ document: object, migrated: boolean }>} rejects
 *   with SyntaxError (not valid JSON) or DocumentValidationError
 *   (well-formed JSON that isn't a document this app recognizes) -
 *   the same errors parseDocument itself throws, just delivered async.
 */
export function readDocumentFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseDocument(reader.result));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error("Could not read the file."));
    };
    reader.readAsText(file);
  });
}

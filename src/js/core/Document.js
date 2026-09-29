/**
 * The FrameX document schema (docs/PRD.md DOC-1), its validator, and the
 * migration from the old, unversioned save format.
 *
 * Deliberately Konva-agnostic: it knows nothing about Stage/Layer/Shape,
 * only about plain-data documents and objects. The bridge between this
 * shape and live Konva nodes lives in CanvasManager
 * (toDocumentObjects/loadDocumentObjects), which reuses its own
 * already-tested per-shape-type toStorageShape/reconstructShapes rather
 * than duplicating that logic here. Keeping this module free of Konva
 * also means it needs no jsdom/canvas mocking to unit test.
 *
 * v1 (the only format this app has ever produced before this module
 * existed) was `{ shapes: [{ type, attrs }, ...] }`: no version marker,
 * no document-level id/name/timestamps, and no per-object id or zIndex
 * (the array's own order was, and still is, the z-order). v2 adds all
 * of those without changing what a "shape" looks like, so migration is
 * a wrap, not a rewrite of every object.
 */

export const DOCUMENT_VERSION = 2;

// The localStorage key this app has always saved under, from before this
// module existed. Exported so core/Persistence.js (docs/TASKS.md P1-4)
// reads/writes the same key rather than duplicating the literal.
export const STORAGE_KEY = "canvasData";

let idCounter = 0;

/**
 * A short, collision-resistant id. Not a cryptographic UUID - documents
 * are per-browser and per-user, not shared identifiers - just something
 * that will not collide within one document's lifetime: current time in
 * base36 (sortable, changes every call) plus a per-page-load counter
 * (guards against two ids requested in the same millisecond) plus a
 * few bytes of randomness (guards across page loads/machines, e.g. two
 * offline edits of copies of the same document later merged).
 */
export function createId(prefix = "obj") {
  idCounter += 1;
  const time = Date.now().toString(36);
  const counter = idCounter.toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}_${counter}${random}`;
}

/**
 * A new, empty document. `meta` lets a caller pin specific fields (used
 * by migration, which must preserve an object's own existing id if it
 * already has one, and by reload, which must keep the same document id
 * and createdAt across saves rather than minting a new one every time).
 */
export function createEmptyDocument(meta = {}) {
  const now = Date.now();
  return {
    version: DOCUMENT_VERSION,
    id: meta.id || createId("doc"),
    name: meta.name || "Untitled",
    createdAt: meta.createdAt ?? now,
    updatedAt: meta.updatedAt ?? now,
    canvas: {
      background: null,
      gridSize: 20,
      unit: "px",
      ...meta.canvas,
    },
    objects: [],
  };
}

/**
 * Structural validation only: are the fields the right shape and type.
 * It does not know what a valid Konva `attrs` bag looks like for any
 * particular `type` (that is CanvasManager/the eventual Phase 3 shape
 * registry's job) - only that every object has the fields every type
 * needs (id, type, zIndex, attrs).
 */
export function validateDocument(doc) {
  const errors = [];

  if (!doc || typeof doc !== "object") {
    return { valid: false, errors: ["document is not an object"] };
  }
  if (doc.version !== DOCUMENT_VERSION) {
    errors.push(
      `unsupported document version ${JSON.stringify(doc.version)}, expected ${DOCUMENT_VERSION}`
    );
  }
  if (typeof doc.id !== "string" || doc.id.length === 0) {
    errors.push("document is missing a string id");
  }
  if (typeof doc.name !== "string") {
    errors.push("document is missing a string name");
  }
  if (typeof doc.createdAt !== "number") {
    errors.push("document is missing a numeric createdAt");
  }
  if (typeof doc.updatedAt !== "number") {
    errors.push("document is missing a numeric updatedAt");
  }
  if (!Array.isArray(doc.objects)) {
    errors.push("document.objects must be an array");
  } else {
    const seenIds = new Set();
    doc.objects.forEach((obj, index) => {
      if (!obj || typeof obj !== "object") {
        errors.push(`objects[${index}] is not an object`);
        return;
      }
      if (typeof obj.id !== "string" || obj.id.length === 0) {
        errors.push(`objects[${index}] is missing a string id`);
      } else if (seenIds.has(obj.id)) {
        errors.push(`objects[${index}] has a duplicate id "${obj.id}"`);
      } else {
        seenIds.add(obj.id);
      }
      if (typeof obj.type !== "string" || obj.type.length === 0) {
        errors.push(`objects[${index}] is missing a string type`);
      }
      if (typeof obj.zIndex !== "number") {
        errors.push(`objects[${index}] is missing a numeric zIndex`);
      }
      if (!obj.attrs || typeof obj.attrs !== "object") {
        errors.push(`objects[${index}] is missing an attrs object`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export class DocumentValidationError extends Error {
  constructor(errors) {
    super(`Invalid document:\n- ${errors.join("\n- ")}`);
    this.name = "DocumentValidationError";
    this.errors = errors;
  }
}

/**
 * Wraps a v1 `{ shapes: [{ type, attrs }, ...] }` blob into a v2
 * document. Every existing shape keeps its type and attrs exactly as
 * they were (including, e.g., a pre-P0-3 Image shape's legacy `svgUrl`
 * attr, which CanvasManager.reconstructShapes already knows how to
 * migrate on its own, independently of this - the two migrations
 * compose rather than needing to know about each other). zIndex comes
 * from array position, since that already was this app's z-order
 * (CanvasManager.addShape pushes to `shapes` and adds to the Konva
 * layer in the same order). id comes from the shape's own attrs if an
 * earlier version of this same migration already ran and it was saved
 * again (idempotent re-migration), otherwise a fresh one is minted -
 * pre-P1-1 saves never had a real id (only the user-editable, not
 * guaranteed unique, `name`).
 */
export function migrateV1ToV2(v1) {
  const shapes = Array.isArray(v1?.shapes) ? v1.shapes : [];
  const doc = createEmptyDocument();
  doc.objects = shapes.map((shape, index) => ({
    id: (shape.attrs && shape.attrs.id) || createId("obj"),
    type: shape.type,
    zIndex: index,
    attrs: shape.attrs || {},
  }));
  return doc;
}

/**
 * Parses and validates a document from either a JSON string or an
 * already-parsed value, migrating from v1 when needed. Throws
 * SyntaxError (invalid JSON) or DocumentValidationError (well-formed
 * JSON that isn't a document this app recognizes) - callers decide how
 * to surface that (console + a status message today; an import
 * dialog's error state once one exists, docs/TASKS.md P1-7/P1-8).
 *
 * @returns {{ document: object, migrated: boolean }}
 */
export function parseDocument(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : input;

  if (raw && raw.version === DOCUMENT_VERSION) {
    const { valid, errors } = validateDocument(raw);
    if (!valid) throw new DocumentValidationError(errors);
    return { document: raw, migrated: false };
  }

  if (raw && Array.isArray(raw.shapes)) {
    return { document: migrateV1ToV2(raw), migrated: true };
  }

  throw new DocumentValidationError([
    "unrecognized document format: expected a v2 document or a legacy " +
      "{ shapes: [...] } save",
  ]);
}

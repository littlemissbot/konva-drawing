import {
  DOCUMENT_VERSION,
  createId,
  createEmptyDocument,
  validateDocument,
  migrateV1ToV2,
  parseDocument,
  DocumentValidationError,
} from "../Document.js";

describe("createId", () => {
  test("ids are unique across many calls in the same tick", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId()));
    expect(ids.size).toBe(500);
  });

  test("uses the given prefix", () => {
    expect(createId("doc")).toMatch(/^doc_/);
    expect(createId("obj")).toMatch(/^obj_/);
  });
});

describe("createEmptyDocument", () => {
  test("has every required field, an empty objects array, and sane defaults", () => {
    const doc = createEmptyDocument();
    expect(doc.version).toBe(DOCUMENT_VERSION);
    expect(typeof doc.id).toBe("string");
    expect(doc.id.length).toBeGreaterThan(0);
    expect(doc.name).toBe("Untitled");
    expect(typeof doc.createdAt).toBe("number");
    expect(typeof doc.updatedAt).toBe("number");
    expect(doc.canvas).toEqual({ background: null, gridSize: 20, unit: "px" });
    expect(doc.objects).toEqual([]);
  });

  test("meta overrides are honored, e.g. to keep a stable id/createdAt across saves", () => {
    const doc = createEmptyDocument({
      id: "doc_fixed",
      name: "My Diagram",
      createdAt: 1000,
      canvas: { unit: "cm" },
    });
    expect(doc.id).toBe("doc_fixed");
    expect(doc.name).toBe("My Diagram");
    expect(doc.createdAt).toBe(1000);
    // canvas overrides merge, they don't replace the whole object
    expect(doc.canvas).toEqual({ background: null, gridSize: 20, unit: "cm" });
  });

  test("validates as-is", () => {
    expect(validateDocument(createEmptyDocument())).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe("validateDocument", () => {
  function validDoc(overrides = {}) {
    return {
      version: DOCUMENT_VERSION,
      id: "doc_1",
      name: "Untitled",
      createdAt: 1,
      updatedAt: 1,
      canvas: { background: null, gridSize: 20, unit: "px" },
      objects: [{ id: "obj_1", type: "Circle", zIndex: 0, attrs: { x: 1 } }],
      ...overrides,
    };
  }

  test("accepts a well-formed document", () => {
    expect(validateDocument(validDoc())).toEqual({ valid: true, errors: [] });
  });

  test.each([
    [null, "document is not an object"],
    [undefined, "document is not an object"],
    ["a string", "document is not an object"],
  ])("rejects %p", (input, expectedError) => {
    const result = validateDocument(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expectedError);
  });

  test("rejects the wrong version", () => {
    const result = validateDocument(validDoc({ version: 1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  test("rejects a missing/empty id", () => {
    expect(validateDocument(validDoc({ id: "" })).valid).toBe(false);
    expect(validateDocument(validDoc({ id: 42 })).valid).toBe(false);
  });

  test("rejects objects that is not an array", () => {
    const result = validateDocument(validDoc({ objects: {} }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("document.objects must be an array");
  });

  test("rejects an object missing id/type/zIndex/attrs, naming which", () => {
    const result = validateDocument(validDoc({ objects: [{ id: "obj_1" }] }));
    expect(result.valid).toBe(false);
    // id is present, so exactly the three other missing fields are reported.
    const objectErrors = result.errors.filter((e) =>
      e.startsWith("objects[0]")
    );
    expect(objectErrors).toHaveLength(3);
    expect(objectErrors.join(" ")).toMatch(/type/);
    expect(objectErrors.join(" ")).toMatch(/zIndex/);
    expect(objectErrors.join(" ")).toMatch(/attrs/);
  });

  test("rejects duplicate object ids", () => {
    const result = validateDocument(
      validDoc({
        objects: [
          { id: "dup", type: "Circle", zIndex: 0, attrs: {} },
          { id: "dup", type: "Rect", zIndex: 1, attrs: {} },
        ],
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  test("an empty objects array is valid (an empty canvas is a valid document)", () => {
    expect(validateDocument(validDoc({ objects: [] })).valid).toBe(true);
  });
});

describe("migrateV1ToV2", () => {
  test("wraps shapes into a v2 document, using array position as zIndex", () => {
    const v1 = {
      shapes: [
        { type: "Circle", attrs: { x: 1, y: 2, name: "Circle 1" } },
        { type: "Rect", attrs: { x: 3, y: 4, name: "Rect 1" } },
      ],
    };
    const doc = migrateV1ToV2(v1);

    expect(doc.version).toBe(DOCUMENT_VERSION);
    expect(doc.objects).toHaveLength(2);
    expect(doc.objects[0]).toMatchObject({
      type: "Circle",
      zIndex: 0,
      attrs: { x: 1, y: 2, name: "Circle 1" },
    });
    expect(doc.objects[1]).toMatchObject({
      type: "Rect",
      zIndex: 1,
      attrs: { x: 3, y: 4, name: "Rect 1" },
    });
    // Every migrated object gets a fresh, distinct id since v1 never had one.
    expect(doc.objects[0].id).toBeTruthy();
    expect(doc.objects[1].id).toBeTruthy();
    expect(doc.objects[0].id).not.toBe(doc.objects[1].id);
  });

  test("preserves an object's own id if it already had one (idempotent re-migration)", () => {
    const v1 = {
      shapes: [{ type: "Circle", attrs: { x: 1, id: "obj_existing" } }],
    };
    const doc = migrateV1ToV2(v1);
    expect(doc.objects[0].id).toBe("obj_existing");
  });

  test("an empty or missing shapes array migrates to an empty document", () => {
    expect(migrateV1ToV2({ shapes: [] }).objects).toEqual([]);
    expect(migrateV1ToV2({}).objects).toEqual([]);
  });

  test("legacy Image attrs (pre-P0-3 absolute svgUrl, no iconFile) pass through untouched", () => {
    // This migration only wraps the document envelope; the separate,
    // per-shape svgUrl->iconFile fallback in
    // CanvasManager.reconstructShapes (docs/TASKS.md P0-3) still runs
    // on whatever attrs come out of here, unmodified.
    const v1 = {
      shapes: [
        {
          type: "Image",
          attrs: { svgUrl: "https://old.example.com/assets/svgs/x.svg" },
        },
      ],
    };
    const doc = migrateV1ToV2(v1);
    expect(doc.objects[0].attrs.svgUrl).toBe(
      "https://old.example.com/assets/svgs/x.svg"
    );
  });

  test("the migrated document validates", () => {
    const doc = migrateV1ToV2({
      shapes: [{ type: "Circle", attrs: { x: 1 } }],
    });
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
  });
});

describe("parseDocument", () => {
  test("parses a JSON string containing a valid v2 document", () => {
    const doc = createEmptyDocument();
    const { document, migrated } = parseDocument(JSON.stringify(doc));
    expect(document).toEqual(doc);
    expect(migrated).toBe(false);
  });

  test("accepts an already-parsed v2 document object directly", () => {
    const doc = createEmptyDocument();
    const { document, migrated } = parseDocument(doc);
    expect(document).toBe(doc);
    expect(migrated).toBe(false);
  });

  test("migrates a v1 JSON string", () => {
    const v1 = { shapes: [{ type: "Circle", attrs: { x: 1 } }] };
    const { document, migrated } = parseDocument(JSON.stringify(v1));
    expect(migrated).toBe(true);
    expect(document.version).toBe(DOCUMENT_VERSION);
    expect(document.objects).toHaveLength(1);
  });

  test("throws SyntaxError on malformed JSON (not swallowed as a validation error)", () => {
    expect(() => parseDocument("{not json")).toThrow(SyntaxError);
  });

  test("throws DocumentValidationError on a v2-labeled but structurally invalid document", () => {
    const bad = { version: DOCUMENT_VERSION, id: "", objects: "not an array" };
    expect(() => parseDocument(bad)).toThrow(DocumentValidationError);
  });

  test("throws DocumentValidationError on a well-formed but unrecognized shape", () => {
    expect(() => parseDocument({ foo: "bar" })).toThrow(
      DocumentValidationError
    );
  });

  test("DocumentValidationError carries the individual error messages", () => {
    // expect() calls inside a try/catch can silently never run if the
    // call under test stops throwing (eslint jest/no-conditional-expect
    // - a real defense, not a style nit: a test written that way keeps
    // passing even after a regression removes the throw entirely).
    // Capturing the error in an unconditional helper keeps every
    // assertion below unconditional instead.
    const error = getThrownError(() =>
      parseDocument({ version: DOCUMENT_VERSION, objects: [] })
    );
    expect(error).toBeInstanceOf(DocumentValidationError);
    expect(error.errors.length).toBeGreaterThan(0);
    expect(error.message).toContain(error.errors[0]);
  });
});

function getThrownError(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw, but it did not");
}

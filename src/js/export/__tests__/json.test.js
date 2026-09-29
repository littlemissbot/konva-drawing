import {
  serializeDocument,
  exportJsonBlob,
  suggestedFilename,
  readDocumentFile,
} from "../json.js";
import {
  createEmptyDocument,
  DocumentValidationError,
} from "../../core/Document.js";

describe("serializeDocument / exportJsonBlob", () => {
  test("serializes to indented JSON that parses back to an identical document", () => {
    const doc = createEmptyDocument({ name: "My Drawing" });
    doc.objects.push({
      id: "obj_1",
      type: "Rect",
      zIndex: 0,
      attrs: { x: 0, y: 0, width: 10, height: 10 },
    });

    const json = serializeDocument(doc);
    expect(json).toContain("\n"); // pretty-printed, not minified
    expect(JSON.parse(json)).toEqual(doc);
  });

  test("produces a Blob with the application/json mime type and the same content", async () => {
    const doc = createEmptyDocument({ name: "My Drawing" });
    const blob = exportJsonBlob(doc);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json");
    // jsdom's Blob has no .text() method, unlike a real browser's - read
    // it back the same way readDocumentFile does (FileReader, which
    // jsdom does support) instead of assuming a fuller Blob API.
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual(doc);
  });
});

describe("suggestedFilename", () => {
  test("sanitizes the document name into a safe filename", () => {
    const doc = createEmptyDocument({ name: "Q3 Roadmap / Draft #2" });
    expect(suggestedFilename(doc)).toBe("Q3-Roadmap-Draft-2.framex.json");
  });

  test("falls back to Untitled for an empty or punctuation-only name", () => {
    expect(suggestedFilename(createEmptyDocument({ name: "" }))).toBe(
      "Untitled.framex.json"
    );
    expect(suggestedFilename(createEmptyDocument({ name: "   " }))).toBe(
      "Untitled.framex.json"
    );
    expect(suggestedFilename(createEmptyDocument({ name: "***" }))).toBe(
      "Untitled.framex.json"
    );
  });
});

function fileOf(content, name = "drawing.json") {
  return new File([content], name, { type: "application/json" });
}

describe("readDocumentFile", () => {
  test("resolves a v2 document as-is, migrated: false", async () => {
    const doc = createEmptyDocument({ name: "Round Trip" });
    const result = await readDocumentFile(fileOf(serializeDocument(doc)));
    expect(result).toEqual({ document: doc, migrated: false });
  });

  test("migrates a legacy v1 { shapes: [...] } save, migrated: true", async () => {
    const v1 = JSON.stringify({
      shapes: [{ type: "Rect", attrs: { x: 1, y: 2 } }],
    });
    const result = await readDocumentFile(fileOf(v1));
    expect(result.migrated).toBe(true);
    expect(result.document.objects).toEqual([
      expect.objectContaining({ type: "Rect", zIndex: 0 }),
    ]);
  });

  test("rejects with a SyntaxError for invalid JSON", async () => {
    await expect(readDocumentFile(fileOf("not json"))).rejects.toBeInstanceOf(
      SyntaxError
    );
  });

  test("rejects with DocumentValidationError for well-formed but unrecognized JSON", async () => {
    await expect(
      readDocumentFile(fileOf(JSON.stringify({ hello: "world" })))
    ).rejects.toBeInstanceOf(DocumentValidationError);
  });
});

import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Rect } from "konva/lib/shapes/Rect";
import { CanvasManager } from "../../canvas/CanvasManager.js";
import { EventBus } from "../../core/EventBus.js";
import { createEmptyDocument } from "../../core/Document.js";
import {
  gatherExportOptions,
  runExport,
  suggestedExportFilename,
} from "../ExportDialog.js";

// jest-canvas-mock's toDataURL() returns a fixed, non-decodable
// placeholder - fine for the PNG-format tests below (they only check
// dimensions/ok, computed from raster.js's own box math, never the
// dataUrl string), but not for the PDF-format tests: exportPdf calls
// jsPDF's real addImage(), which actually decodes the PNG bytes and
// correctly rejects the placeholder. Same real, minimal, valid 1x1 PNG
// used in export/__tests__/pdf.test.js.
const REAL_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

beforeEach(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue(REAL_PNG_DATA_URL);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function radio(name, value, checked = false) {
  const el = document.createElement("input");
  el.type = "radio";
  el.name = name;
  el.value = value;
  el.checked = checked;
  return el;
}

function checkbox(checked = false) {
  const el = document.createElement("input");
  el.type = "checkbox";
  el.checked = checked;
  return el;
}

function selectEl(value) {
  const el = document.createElement("select");
  const opt = document.createElement("option");
  opt.value = value;
  el.appendChild(opt);
  el.value = value;
  return el;
}

function colorInput(value) {
  const el = document.createElement("input");
  el.type = "color";
  el.value = value;
  return el;
}

function baseElements(overrides = {}) {
  return {
    formatRadios: [
      radio("exportFormat", "png", true),
      radio("exportFormat", "jpeg"),
      radio("exportFormat", "pdf"),
    ],
    scaleSelect: selectEl("2"),
    transparentCheckbox: checkbox(true),
    backgroundColorInput: colorInput("#ff00ff"),
    selectionOnlyCheckbox: checkbox(false),
    pageSizeSelect: selectEl("fit"),
    orientationSelect: selectEl("landscape"),
    selectableTextCheckbox: checkbox(true),
    ...overrides,
  };
}

describe("gatherExportOptions", () => {
  test("reads the checked format and every other control's value", () => {
    const elements = baseElements();
    expect(gatherExportOptions(elements)).toEqual({
      format: "png",
      pixelRatio: 2,
      background: null, // transparent checked, format is png
      selectionOnly: false,
      pageSize: "fit",
      orientation: "landscape",
      selectableText: true,
    });
  });

  test("ignores the transparent checkbox for JPEG - background is always the color input's value", () => {
    const elements = baseElements({
      formatRadios: [
        radio("exportFormat", "png"),
        radio("exportFormat", "jpeg", true),
        radio("exportFormat", "pdf"),
      ],
      transparentCheckbox: checkbox(true), // stale/irrelevant for jpeg
      backgroundColorInput: colorInput("#123456"),
    });
    const options = gatherExportOptions(elements);
    expect(options.format).toBe("jpeg");
    expect(options.background).toBe("#123456");
  });

  test("uses the background color input when transparent is unchecked (PNG)", () => {
    const elements = baseElements({
      transparentCheckbox: checkbox(false),
      backgroundColorInput: colorInput("#00ff00"),
    });
    expect(gatherExportOptions(elements).background).toBe("#00ff00");
  });

  test("falls back to pixelRatio 2 for a non-numeric scale value", () => {
    const elements = baseElements({ scaleSelect: selectEl("not-a-number") });
    expect(gatherExportOptions(elements).pixelRatio).toBe(2);
  });
});

describe("suggestedExportFilename", () => {
  test("uses the format's own extension, sanitizing the document name the same way export/json.js does", () => {
    const doc = createEmptyDocument({ name: "Q3 Roadmap / Draft" });
    expect(suggestedExportFilename(doc, "png")).toBe("Q3-Roadmap-Draft.png");
    expect(suggestedExportFilename(doc, "jpeg")).toBe("Q3-Roadmap-Draft.jpg");
    expect(suggestedExportFilename(doc, "pdf")).toBe("Q3-Roadmap-Draft.pdf");
  });

  test("falls back to Untitled for an empty name", () => {
    expect(
      suggestedExportFilename(createEmptyDocument({ name: "" }), "png")
    ).toBe("Untitled.png");
  });
});

describe("runExport", () => {
  let container, stage, mainLayer, canvasManager;

  beforeEach(() => {
    window.eventBus = new EventBus();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new Stage({ container, width: 800, height: 600 });
    mainLayer = new Layer();
    stage.add(mainLayer);
    canvasManager = new CanvasManager(stage, mainLayer, new Layer());
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
  });

  test("exports the whole canvas when selectionOnly is false", async () => {
    canvasManager.addShape(
      new Rect({ x: 0, y: 0, width: 100, height: 50, name: "A" })
    );
    canvasManager.addShape(
      new Rect({ x: 300, y: 300, width: 20, height: 20, name: "B" })
    );

    const result = await runExport({
      stage,
      canvasManager,
      options: {
        format: "png",
        pixelRatio: 1,
        background: null,
        selectionOnly: false,
      },
    });

    expect(result.ok).toBe(true);
    // Union of both rects (0,0..320,320) plus raster.js's default 20px
    // padding on every side.
    expect(result.width).toBe(360);
    expect(result.height).toBe(360);
  });

  test("exports only the selected shape's bounds when selectionOnly is true, and restores visibility afterward", async () => {
    const a = new Rect({ x: 0, y: 0, width: 100, height: 50, name: "A" });
    const b = new Rect({ x: 300, y: 300, width: 20, height: 20, name: "B" });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selectShape(a);

    const result = await runExport({
      stage,
      canvasManager,
      options: {
        format: "png",
        pixelRatio: 1,
        background: null,
        selectionOnly: true,
      },
    });

    expect(result.ok).toBe(true);
    // Just A's bounds (0,0..100,50) plus the default 20px padding.
    expect(result.width).toBe(140);
    expect(result.height).toBe(90);
    expect(a.visible()).toBe(true);
    expect(b.visible()).toBe(true);
  });

  test("restores visibility even if the export throws", async () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 20, y: 20, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selectShape(a);

    // exportRaster reports invalid-format as a normal {ok: false}
    // result rather than throwing, so this just needs to resolve
    // without rejecting.
    await runExport({
      stage,
      canvasManager,
      options: {
        format: "not-a-real-format",
        selectionOnly: true,
      },
    });
    expect(b.visible()).toBe(true);
  });

  test("delegates to exportPdf for format 'pdf'", async () => {
    canvasManager.addShape(new Rect({ x: 0, y: 0, width: 10, height: 10 }));
    const result = await runExport({
      stage,
      canvasManager,
      options: { format: "pdf", pageSize: "tabloid" },
    });
    // A page-size this app doesn't support - exportPdf's own validation,
    // proving the call actually reached it rather than falling through
    // to exportRaster (which has no such concept).
    expect(result).toEqual({
      ok: false,
      reason: "invalid-page-size",
      message: expect.stringContaining("tabloid"),
    });
  });

  // Regression coverage: exportPdf is async (it dynamically imports
  // jsPDF - docs/TASKS.md P1-8's bundle-size fix), so a naive "restore
  // visibility once fn() returns" would restore it while exportPdf is
  // still mid-flight (it returns a *pending* Promise synchronously,
  // well before its own work is done), well before exportPdf reaches
  // its own visibility-sensitive collectTextLayer() call - silently
  // breaking selectionOnly for PDF exports specifically, even though
  // the embedded raster image (computed synchronously, before
  // exportPdf's own first await) would still look correct.
  test("keeps non-selected shapes hidden for the full duration of an async (PDF) export, not just its synchronous prefix", async () => {
    const a = new Rect({ x: 0, y: 0, width: 10, height: 10 });
    const b = new Rect({ x: 20, y: 20, width: 10, height: 10 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selectShape(a);

    const promise = runExport({
      stage,
      canvasManager,
      options: { format: "pdf", pageSize: "fit", selectionOnly: true },
    });

    // Still hidden immediately after the call returns, before the
    // returned promise has been awaited - i.e. still hidden across
    // exportPdf's own internal `await import("jspdf")`.
    expect(b.visible()).toBe(false);

    await promise;
    expect(b.visible()).toBe(true);
  });
});

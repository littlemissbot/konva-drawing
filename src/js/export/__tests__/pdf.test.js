import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Rect } from "konva/lib/shapes/Rect";
import { Text } from "konva/lib/shapes/Text";
import { exportPdf } from "../pdf.js";

// jest-canvas-mock's toDataURL() returns a fixed, non-decodable placeholder
// ("data:image/png;base64,00") - fine for raster.test.js, which only
// asserts on that string, but not here: exportPdf calls jsPDF's real
// addImage(), which actually decodes the PNG bytes (via fast-png) to embed
// them, and correctly rejects the placeholder as a bad PNG signature. This
// is a real, minimal, valid 1x1 transparent PNG so that decode succeeds;
// the tests below then verify exportPdf's own logic (page sizing, empty/
// invalid-input handling, text layer), not the mocked image's pixels -
// real rendered-pixel verification is e2e/export.spec.js's job, same split
// already used for raster.test.js's background-color test.
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

function setUpStage({ width = 800, height = 600 } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const stage = new Stage({ container, width, height });
  const layer = new Layer();
  stage.add(layer);
  return {
    stage,
    layer,
    cleanup: () => {
      stage.destroy();
      container.remove();
    },
  };
}

describe("exportPdf", () => {
  test("rejects an unsupported page size", async () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 10, height: 10 }));
    const result = await exportPdf(stage, { pageSize: "tabloid" });
    expect(result).toEqual({
      ok: false,
      reason: "invalid-page-size",
      message: expect.stringContaining("tabloid"),
    });
    cleanup();
  });

  test("reports an empty canvas rather than producing a blank page", async () => {
    const { stage, cleanup } = setUpStage();
    const result = await exportPdf(stage);
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });
    cleanup();
  });

  test("produces a PDF blob and data URL for pageSize 'fit'", async () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 100, height: 50, fill: "#f00" }));

    const result = await exportPdf(stage, { pageSize: "fit" });

    expect(result.ok).toBe(true);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe("application/pdf");
    expect(result.dataUrl).toMatch(/^data:application\/pdf/);
    cleanup();
  });

  test.each(["a4", "letter"])(
    "produces a PDF for the fixed page size '%s' in both orientations",
    async (pageSize) => {
      const { stage, layer, cleanup } = setUpStage();
      layer.add(new Rect({ x: 0, y: 0, width: 100, height: 50 }));

      const portrait = await exportPdf(stage, {
        pageSize,
        orientation: "portrait",
      });
      const landscape = await exportPdf(stage, {
        pageSize,
        orientation: "landscape",
      });

      expect(portrait.ok).toBe(true);
      expect(landscape.ok).toBe(true);
      cleanup();
    }
  );

  test("does not throw/reject with Text nodes present, whether or not the selectable text layer is requested", async () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 200, height: 100 }));
    layer.add(new Text({ x: 10, y: 10, text: "Hello, FrameX", fontSize: 16 }));

    // .resolves (rather than a bare await) both fails the test if the
    // promise rejects and gives jest/expect-expect a real assertion to
    // see, instead of a rejected promise being the only signal.
    await expect(
      exportPdf(stage, { pageSize: "fit", selectableText: true })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      exportPdf(stage, { pageSize: "fit", selectableText: false })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      exportPdf(stage, { pageSize: "a4", selectableText: true })
    ).resolves.toMatchObject({ ok: true });
    cleanup();
  });

  test("an invisible/off-stage Text node does not break export", async () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 50, height: 50 }));
    const hidden = new Text({ x: 0, y: 0, text: "hidden", visible: false });
    layer.add(hidden);

    await expect(exportPdf(stage)).resolves.toMatchObject({ ok: true });
    cleanup();
  });
});

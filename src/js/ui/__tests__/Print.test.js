import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Rect } from "konva/lib/shapes/Rect";
import { buildPrintDocument, printCanvas } from "../Print.js";

describe("buildPrintDocument", () => {
  test("embeds the data URL in an <img> and sizes the page to it with no margin", () => {
    const html = buildPrintDocument("data:image/png;base64,AAAA");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("@page { margin: 0; }");
  });
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

describe("printCanvas", () => {
  test("reports an empty canvas rather than opening a blank print dialog, and touches no DOM", () => {
    const { stage, cleanup } = setUpStage();
    const iframeCountBefore = document.querySelectorAll("iframe").length;

    const result = printCanvas(stage);

    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: expect.stringContaining("empty"),
    });
    expect(document.querySelectorAll("iframe").length).toBe(iframeCountBefore);
    cleanup();
  });

  test("appends a hidden iframe with the rendered PNG written into it", () => {
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 50, height: 50 }));

    const result = printCanvas(stage);

    expect(result).toEqual({ ok: true });
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const img = iframe.contentWindow.document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toMatch(/^data:image\/png/);

    stage.destroy();
    iframe.remove();
    cleanup();
  });

  test("removes the iframe on its own after the fallback timeout, even if afterprint never fires", () => {
    jest.useFakeTimers();
    const { stage, layer, cleanup } = setUpStage();
    layer.add(new Rect({ x: 0, y: 0, width: 50, height: 50 }));

    printCanvas(stage);
    expect(document.querySelector("iframe")).not.toBeNull();

    jest.advanceTimersByTime(60000);
    expect(document.querySelector("iframe")).toBeNull();

    jest.useRealTimers();
    cleanup();
  });
});

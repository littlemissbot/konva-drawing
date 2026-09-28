// Mocks the HTMLCanvasElement 2D context so Konva can construct Stages,
// Layers and shapes under jsdom without a native canvas binding. It does
// not produce real pixels, which is fine here: unit tests assert on
// Konva's data model (attrs, node tree, events), not rendered output.
require("jest-canvas-mock");

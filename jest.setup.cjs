// Mocks the HTMLCanvasElement 2D context so Konva can construct Stages,
// Layers and shapes under jsdom without a native canvas binding. It does
// not produce real pixels, which is fine here: unit tests assert on
// Konva's data model (attrs, node tree, events), not rendered output.
require("jest-canvas-mock");

// jsdom's simulated global scope (what "global"/"window" is inside a
// test under testEnvironment: "jsdom") doesn't include structuredClone,
// even though the real Node process running Jest has had it globally
// since Node 17 - and jest.setup.cjs itself runs inside that same
// jsdom-replaced scope, not the outer Node one, so there is no bare
// `structuredClone` reference to copy in here either. fake-indexeddb
// (used to test core/Persistence.js's IndexedDB fallback) needs
// *some* implementation to clone stored values the way real IndexedDB
// does. Persistence.js only ever stores a JSON string in IndexedDB
// (idbPut(JSON.stringify(document))), so a JSON-round-trip clone is
// fully correct for what this app actually stores there, without
// needing a real structuredClone (which also handles Dates, Maps,
// circular references, etc. - none of which apply here).
if (typeof global.structuredClone === "undefined") {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

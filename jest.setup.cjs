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

// jsPDF (used to test export/pdf.js, docs/TASKS.md P1-6) pulls in
// fast-png/iobuffer, which need TextEncoder/TextDecoder - also missing
// from jsdom's simulated global scope. Unlike structuredClone above,
// these don't need a shim: Node's own real implementations are
// reachable via require("util") (a CommonJS require, unlike a bare
// global reference, still resolves through to the outer Node process
// regardless of jsdom replacing the global scope), so the real thing is
// used rather than approximating one.
if (typeof global.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util");
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

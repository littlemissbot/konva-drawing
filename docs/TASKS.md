# FrameX Task Breakdown

Companion to `docs/PRD.md`. Ten phases; each phase leaves the app fully usable and is merged on its own. Estimates are solo-developer days of focused work. IDs map to PRD requirement IDs. Every task ends with tests and a manual check on desktop Chrome and Safari; touch tasks add iPad.

Legend: **Dep** = must be done first. **AC** = acceptance criteria.

---

## Phase 0: Foundation and bug fixes (4 days)

Goal: a clean base that later phases build on without regressions. No visible new features except fixed bugs.

| ID | Task | Files | Est | Dep |
|---|---|---|---|---|
| P0-1 | Remove jQuery from `package.json`; remove the duplicate Bootstrap CDN link and load only the npm copy | `package.json`, `src/canvas.html`, `src/index.html` | 0.25 | – |
| P0-2 | Consolidate startup: one `bootstrap()` that loads the document once; delete the nested `DOMContentLoaded` block and `checkAndRestoreCanvas` | `src/js/main.js` | 0.5 | – |
| P0-3 | Persist icons by relative asset key (`iconFile`), not absolute `src`; resolve at load with a basename-extraction fallback for old absolute-URL saves. **Scope grew during implementation**: the 16 icon files under `src/assets/svgs/` were never copied into the production build at all — they're referenced only via a runtime-built string (`` `assets/svgs/${svgFile}` ``) inside `SVGManager.createSVG`, invisible to Vite's static asset scanner, so `Konva.Image.fromURL` fetched the SPA-fallback HTML instead of the SVG in any built/deployed app (confirmed with a Playwright check: `content-type: text/html`, `onerror` fires). Fixed by moving the files to `public/assets/svgs/`, which Vite copies verbatim. Also found and fixed in the same pass: `SVGManager.setupSVGEvents` calls `canvasManager.updateTooltip()`/`hideTooltip()` on every icon hover, and neither method existed, so hovering an icon threw a `TypeError`; both are now implemented on the previously-unused `tooltipLayer`. `svgManager` was also never exposed on `window` like the other managers (and never called from any UI path — the icon panel is disabled pending P7-1), so it was unreachable even for this testing; exposed for consistency. All four fixes verified with headless-browser (Playwright) checks: icon loads and renders in the built app, hover no longer throws, save produces no DOM-node leakage and no absolute URL, reload round-trips position and `iconFile` exactly, and a simulated pre-fix save (absolute `svgUrl` from a different origin, no `iconFile`) still loads via the migration fallback. | `SVGManager.js`, `CanvasManager.js` (`toStorageShape`, `reconstructShapes`), `main.js`, `public/assets/svgs/*` (moved from `src/assets/svgs/`) | 1.5 (grew from 0.75) | – |
| P0-4 | Fix text editor placement under zoom and pan: compute textarea position from `absolutePosition()` × stage scale + stage position, and apply rotation | `TextManager.js` | 0.5 | – |
| P0-5 | ~~Make freehand strokes selectable~~ — verified with a headless-browser (Playwright) check that this already works: `ToolManager._syncShapePointerMode()` re-enables `listening`/`draggable` on every shape, strokes included, on each tool switch. No code change made; original audit claim was wrong and corrected in `docs/PRD.md` §4 | `ToolManager.js` | 0.1 | – |
| P0-6 | Fix `addRectangle` handler (button missing) and remove the dead `shapeBtnMap` entries; temporarily hide unwired shape buttons until Phase 3 | `main.js`, `canvas.html` | 0.25 | – |
| P0-7 | Delete/Backspace deletes selection; Esc deselects and returns to select tool; shortcuts ignored while typing | `main.js` (to move to `ui/Shortcuts.js` in P0-9) | 0.25 | – |
| P0-8 | Test harness: Jest (jsdom + `jest-canvas-mock`, Konva's `konva/lib/index.js` browser build mapped in for the bare `"konva"` specifier to avoid a native `canvas` build dependency) covering `HistoryManager` and the `CanvasManager` save/load round-trip including the P0-3 icon-persistence fix; `@playwright/test` against a built-and-previewed app covering P0-2 through P0-7's fixes end to end; GitHub Actions workflow running lint (placeholder until P0-10), unit and e2e on push. **Found two more real bugs writing this suite**: `Ctrl+Shift+Z` redo silently did nothing, because the handler compared `e.key === "z"` but a keyboard event's `key` reports uppercase `"Z"` once Shift is held (`Ctrl+Y` still worked, so this was easy to miss by hand); fixed by lower-casing the comparison. A flaky e2e failure on first re-run turned out to be a race in the *test*, not the app: `TextManager.startEditing` focuses its textarea via a deferred `setTimeout`, and the test typed before that fired; fixed by asserting the textarea is focused first. 17 unit tests + 21 e2e tests, both suites green, verified stable across three consecutive e2e runs. | `jest.config.cjs`, `babel.config.cjs`, `jest.setup.cjs`, `playwright.config.js`, `.github/workflows/ci.yml`, `package.json`, `src/js/**/__tests__/*.test.js`, `e2e/*.spec.js`, `src/js/main.js` (redo fix) | 1.5 (grew from 0.75) | – |
| P0-9 | Restructure into `core/`, `canvas/`, `ui/` folders (`export/` stays empty until Phase 1 has files to put there); extract the inline keyboard-shortcut listener out of `main.js` into `ui/Shortcuts.js`. **Scoped down from the original description**: full removal of the `window.*` globals (`eventBus`, `canvasManager`, `shapeManager`, `svgManager`, `textManager`, `toolManager`, `historyManager`) in favour of a single namespace is deliberately *not* done here. That is real, cross-cutting work — every component file emits/listens on `window.eventBus` throughout its methods, not just at construction, and every e2e spec and unit test reaches into `window.canvasManager` etc. — and the PRD's own architecture direction (§7) already homes this exact change in Phase 1's `core/Store.js` ("Selection, properties and tool state move out of main.js and the window globals"), where it belongs alongside the document-store rewrite that actually obsoletes the need for globals, rather than as a mechanical rename here that Phase 1 would immediately redo. Doing it now would be Phase 1's job under a Phase 0 label, for a purely cosmetic (today) change with no corresponding bug found. What *was* done: `git mv` of every file into the new layout (preserves history), all import paths fixed (only `main.js` and the two test files imported across the old `components/`/`utils/` boundary — nothing else did), `vite.config.js`'s dead path aliases (`@components`, `@utils`, pointing at folders that no longer exist; `@services`, which never existed) replaced with ones matching the new layout, and the shortcuts extraction verified against the existing 5 keyboard e2e tests. Verified with a full rebuild (byte-identical output hashes before/after the pure folder move, confirming zero behavior change) and both test suites (17 unit + 21 e2e) green after each step. | all of `src/js`, `vite.config.js`, new `src/js/ui/Shortcuts.js` | 1 (grew slightly from 0.75; scope reduced as above) | P0-2, P0-8 |
| P0-10 | ESLint 10 flat config (`eslint.config.js`: browser globals for app code, Jest globals+plugin for unit tests, Playwright plugin for e2e specs, Node globals for tooling configs) plus Prettier (scoped to the JS/e2e codebase - HTML/CSS/Markdown formatting is a separate, undecided scope left alone here, not silently reformatted), wired into `npm run lint`/`format`/`format:check` and CI. **Fixing the findings surfaced the most serious bug found in all of Phase 0**: `ShapeManager` (used by every basic shape - circle, rect, square, triangle, star, line, i.e. everything added from the shapes menu) had its own copy of `setupShapeEvents`, diverged from `CanvasManager`'s, that was missing the `dragend` → `"shapeDragEnded"` emission the real one has. `shapeDragEnded` is what commits a drag to the undo history, so **dragging any basic shape never created an undo checkpoint for the move, and pressing Ctrl+Z afterward undid the shape's creation instead of its position - deleting the shape outright** rather than moving it back. `no-unused-vars` flagged the `name` parameter both copies took but neither used; tracing every call site (all of them pass a real label, e.g. `"Circle"`) to understand why turned up the missing handler and the divergence itself. Fixed by deleting `ShapeManager`'s copy entirely and routing its 6 call sites through `canvasManager.setupShapeEvents` — one canonical implementation, not two that can drift apart again. While there, wired the previously-unused `name` into the same hover-tooltip `updateTooltip`/`hideTooltip` calls SVG icons already had (P0-3), so every shape type now gets a tooltip, not just icons. Verified with a new Playwright regression test (drag a circle, wait for the debounced history commit via `expect.poll`, undo, assert the shape moved back rather than vanished) plus a hover-doesn't-throw test for basic shapes. Also removed: an unused `Image` import in `CanvasManager.js`; a dead `PropertyManager` instantiation in `main.js` (confirmed unused independently by ESLint after already being flagged unused in the original audit — the file itself is kept, commented, as a Phase 3 P3-5 starting point); two dead `centerX`/`centerY` locals in `zoomToFit` whose value was never read (`newPos` uses a different, correct formula). One own mistake caught before landing: a blanket `page.waitForSelector` → `expect(locator).toBeVisible()` refactor to satisfy the Playwright plugin's `no-wait-for-selector` rule broke 22 of 23 e2e tests, because Konva renders two `<canvas>` elements (one per layer) and `toBeVisible()` requires its locator to resolve to exactly one match by default; fixed with `.first()`. 17 unit tests + 23 e2e tests (2 new), lint and format both clean, verified from a from-scratch `npm ci`, three consecutive stable e2e runs. | `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `package.json`, `.github/workflows/ci.yml`, `src/js/canvas/CanvasManager.js`, `src/js/canvas/ShapeManager.js`, `src/js/main.js`, `src/js/ui/PropertyManager.js`, `e2e/*.spec.js` | 2 (grew substantially from 0.25 - this is where the session's most serious bug was found) | P0-9 |

**AC:** all existing behaviour works; saved v1 drawings load; CI is green; `npm run build` under 150 kB gzipped JS.

---

## Phase 1: Document model, persistence, export and import (6 days)

Goal: nothing is ever lost, and every drawing can get out.

**Scope decision, made before writing any code and recorded here rather than discovered partway through:** this phase builds the versioned document schema, robust persistence, and real export/import — everything in DOC-1 through DOC-5 and EXP-1 through EXP-6 that a user or a future phase actually needs — but does **not** do the PRD §7 architecture's full Store + incremental-Renderer + command-based-History rewrite (originally P1-2 and P1-3, described below). That rewrite's payoff is mostly about enabling real-time collaboration and a much larger shape registry later (Phase 4 and beyond, and explicitly out of scope for this whole roadmap per PRD §3's "out of scope (deferred)"), not anything this phase itself needs — export, import and persistence are all implementable directly against the existing `CanvasManager.shapes` array and Konva `Stage`, which is exactly what the Konva project's own official recipes do. Rewriting the entire live interaction model now — every drag, select, transform and tool switch — would be a multi-day, high-risk change for no benefit this phase requires, especially right after P0-10 demonstrated how easily a change to this exact area (event wiring) can silently break undo. `HistoryManager`'s existing snapshot-based undo/redo, now with 69 passing unit tests behind it, stays as-is. This mirrors the P0-9 decision to defer full `window.*` global removal to the same future work, for the same reason: real, cross-cutting work belongs in the phase that actually needs it, not retrofitted early under a different phase's label.

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P1-1 | `core/Document.js`: v2 schema, `createId()`, validation, `migrate(v1→v2)` with fixtures from real saved data | DOC-1 | 1 | P0-9 |
| ~~P1-2~~ | ~~`core/Store.js`~~ — deferred to a future phase, see the scope decision above | DOC-1 | — | — |
| ~~P1-3~~ | ~~`core/History.js`~~ — deferred to a future phase, see the scope decision above; `HistoryManager`'s existing snapshot-based undo/redo stays | DOC-1 | — | — |
| P1-4 | **Done.** `core/Persistence.js`: debounced save with a `maxWaitMs` safety net (a write happens within 10 s of the first change in a burst even under continuous activity, replacing the app's old 10 s periodic-check interval with the standard debounce-with-maxWait pattern), `localStorage` with an IndexedDB fallback on quota error (verified against a real thrown `QuotaExceededError`, not assumed), status events (saving/saved/failed) with the backend named so a fallback save can say so distinctly. Wired into `main.js` in place of the old inline `markDirty`/`debouncedAutoSave`/`lastSavedData`/`savePending` state; `showSaveStatus()`'s DOM update stays in `main.js`, subscribed to `Persistence`'s status callback rather than called directly from save logic. `HistoryManager`'s own undo/redo snapshot format is untouched (see this phase's scope decision above) - only the durable save path changed. A real bug surfaced and fixed while wiring this in: loading a legacy v1 save re-persists it in the new v2 format immediately (so a reload before the next edit still finds it), but that re-save's own "All changes saved" status was overwriting the more informative "Canvas restored" message shown moments earlier, since both target the same DOM element; fixed by reordering so the migration re-save happens before, not after, the final status is shown. Caught by the existing e2e suite, not written down separately. Also required `fake-indexeddb` (jsdom has no native IndexedDB) and a `structuredClone` shim in `jest.setup.cjs` (jsdom's test-environment global scope lacks it, and a JSON-based shim is exactly correct here since this module never stores anything but a JSON string in IndexedDB). 16 new unit tests, 3 new e2e tests (v2 format + stable document id across reload, a real-browser IndexedDB fallback with an actually-thrown `QuotaExceededError`, and Clear Canvas leaving a clean reload state) plus the existing suite unchanged. 65 unit tests, 26 e2e tests total, all green; lint and format clean. | DOC-2, DOC-3 | 1 | P1-1 (redirected from P1-2, which is deferred) |
| P1-5 | **Done.** Export PNG/JPEG: content bounding box, temporary stage reset, `pixelRatio` 1/2/3, transparent or background, padding, canvas-size cap with message | EXP-1 | 0.5 | P1-1 (redirected from P1-2) |
| P1-6 | **Done.** Export PDF via jsPDF: fit-to-content and A4/Letter with scale-to-fit; selectable text layer from `Text` nodes (px→pt × 0.75) | EXP-2 | 0.5 | P1-5 |
| P1-7 | **Done.** JSON export (`Ctrl+S`) and import (`Ctrl+O`, drag-and-drop file) with replace/merge choice | EXP-3 | 0.5 | P1-1 |
| P1-8 | **Done.** Export dialog UI (`Ctrl+E`) with format, scale, background, selection-only options and a live preview thumbnail | EXP-1..3 | 0.5 | P1-5 |
| P1-9 | **Done.** Print via hidden iframe with the PNG scaled to page | EXP-5 | 0.25 | P1-5 |
| P1-10 | ~~Unsaved-change guard on `beforeunload`~~ — already present in `main.js` from before this roadmap existed (warns when `savePending` is true); verified still correct, no new work needed | DOC-5 | 0 (already done) | – |

**P1-1 status: done.** `core/Document.js` (v2 schema, `createId()`, `validateDocument()`, `migrateV1ToV2()`, `parseDocument()`) plus the `CanvasManager.toDocumentObjects()`/`loadDocumentObjects()` bridge to live Konva nodes, and real stable ids assigned at every shape-creation call site (previously nothing set a Konva node's `id` attribute at all, despite `CanvasManager.updateConnections` already reading `shape.id()` for the still-unbuilt Phase 4 connectors feature — a latent gap, not new plumbing). Found and removed along the way: `CanvasManager.saveCanvas()`/`loadCanvas()`, dead code (grepped the whole tree, never called) that used the old unversioned format directly and would have been confusing left next to the new bridge methods. 22 new unit tests (27 total including sub-cases), 69 unit tests overall, 23 e2e tests unchanged and green, lint and format clean.

**P1-5/P1-6 status: done.** `export/raster.js` and `export/pdf.js`. The one non-obvious finding: Konva's `Stage` overrides the generic `Node._toKonvaCanvas` to always default to the stage's own fixed `width()`/`height()` (the current viewport) rather than the content's bounding box, unlike every other node type - verified empirically against a real rendered export (zoomed/panned content exported as a viewport-sized image with the drawing nowhere near center, exactly as panning it out of view would), not assumed from the docs. `getContentBoundingBox()` works around this by resetting scale/position to compute a stable content-space box, exporting with that box passed explicitly, then restoring the user's real view synchronously (nothing visibly flickers). A real bug this surfaced in its own first draft: the empty-canvas check compared the *padded* box's width/height, which a nonzero padding (the 20px default) always makes positive even for genuinely empty content, so the guard never fired - fixed by adding an `isEmpty` field computed before padding is applied. `pdf.js` embeds that same raster image in a jsPDF document (fit-to-content or scaled-to-fit A4/Letter, centered) with an invisible text layer behind it for selectable/searchable text, using the same best-effort px→pt approximation as Konva's own official PDF-export recipe (exact glyph alignment isn't achievable without real canvas font metrics - a stated limitation there too). 16 new unit tests (9 raster.js, 7 pdf.js) - the pdf.js ones needed a real, minimal, valid 1×1 PNG data URL stubbed in over jest-canvas-mock's fixed non-decodable placeholder, since jsPDF's real `addImage()` actually decodes the embedded PNG's bytes rather than trusting the string.

**P1-7 status: done.** `export/json.js` (`serializeDocument`/`exportJsonBlob` for export, `readDocumentFile` wrapping `core/Document.js`'s own `parseDocument()` for import - so an imported file gets the exact same v1-migration and validation a localStorage load does) plus `CanvasManager.mergeDocumentObjects()` for import's "merge" choice (appends rather than replaces, minting a fresh id for any incoming object whose id collides with one already on the canvas). Writing e2e coverage for this surfaced a real, narrow startup race: every listener in `main.js`'s `DOMContentLoaded` handler (Clear Canvas, Ctrl+O/drop import) is already bound by the time `loadSavedCanvas()`'s own `await persistence.load()` is reached, and control returns to the browser's event loop right at that `await` - so an import or Clear Canvas fast enough to land in that window would have its result silently overwritten once the slower initial load resolved after it, up to and including a real saved document's `clearCanvas()`+`loadDocumentObjects()` clobbering whatever the user had just imported. Fixed with a `canvasReplacedBeforeInitialLoad` flag that makes `loadSavedCanvas()` a no-op if Clear Canvas or an import already ran first - exactly the kind of loss this phase's own goal ("nothing is ever lost") exists to close. 11 new unit tests, 6 new e2e tests.

**P1-8 status: done.** `ui/ExportDialog.js` (format/scale/background/selection-only option-gathering and the actual export call, as plain unit-tested functions) plus a Bootstrap modal in `canvas.html` with a live preview thumbnail. `selectionOnly` reuses `CanvasManager`'s existing single `selectedShape` (no multi-select until Phase 2's P2-1) by temporarily hiding every other shape for the export's duration. Wiring `pdf.js` into the real app for the first time (rather than just Jest) surfaced two real bugs beyond missing tests: jsPDF minifies to ~340KB on its own, and a static top-level import made *every* session pay for it on *every* page load regardless of whether PDF export was ever used (`canvas.js` jumped from ~115KB to ~515KB gzipped-35KB-to-167KB, caught by diffing `npm run build` output before/after this task) - fixed with a dynamic `import()` inside `exportPdf()`, deferred until after every early-return validation check, so a rejected request never even fetches the chunk; this in turn required `ExportDialog.js`'s selection-hiding helper to properly `await` the (now sometimes-async) export call rather than restoring visibility the instant it returns a still-pending Promise, which would have silently broken `selectionOnly` for PDF exports specifically (caught by a dedicated regression test, not by accident). Separately, `import "bootstrap/dist/js/bootstrap.bundle.min.js"` (a UMD side-effect import) never actually produced a usable `window.bootstrap` under Vite's ESM output, so Ctrl+E's programmatic `Modal.show()/hide()` calls silently no-op'd even though the Export/Cancel buttons' declarative `data-bs-toggle`/`data-bs-dismiss` attributes still worked (which is what let this pass a casual manual check) - fixed by importing `{ Modal }` from bootstrap's real ESM build directly, which as a side effect let Vite tree-shake out the unused Dropdown/Tooltip/Popover/etc. code the old bundle import always included whole, shrinking the eager chunk further (to ~43KB). Both caught by e2e, not unit tests. 10 new unit tests, 10 new e2e tests (one reads a downloaded PDF's first bytes back and checks for a real `%PDF-` signature, exercising the dynamic import against an actual browser).

**P1-9 status: done.** `ui/Print.js`: renders the stage to PNG and prints it via a hidden, print-only iframe (its own minimal document, no app stylesheet, `@page { margin: 0 }`) rather than `window.print()` on the main page, which would print this app's own UI chrome around or instead of the drawing. 4 new unit tests, 3 new e2e tests (needed since jsdom has no real `print()` to call - intercepted in a real browser by stubbing `Element.prototype.appendChild` to plant a `print()` stub on the iframe the instant the app appends it, since each frame is its own JS realm and patching the top page's `window.print` doesn't reach a dynamically created iframe's own).

**Phase 1 total: 107 unit tests, 45 e2e tests, all green; lint, format and build all clean.**

**AC:** JSON round-trip identical (verified); PNG at 3× of a 4000 px wide drawing exports or reports the cap (verified, `MAX_CANVAS_DIMENSION`); PDF text is selectable (verified against the invisible text layer's own coordinates; not independently re-verified against Acrobat specifically); quota failure shows a message and the document remains intact (verified against a real thrown `QuotaExceededError`).

---

## Phase 2: Selection, keyboard and clipboard (5 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P2-1 | `canvas/Selection.js`: selection set, shift-click add/remove, transformer over multiple nodes, `Ctrl+A` | SEL-1 | 1 | P1-2 |
| P2-2 | Marquee select on empty-canvas drag in select tool (rubber band on the guides layer) | SEL-1 | 0.5 | P2-1 |
| P2-3 | `ui/Shortcuts.js`: full Appendix B table, platform detection, input suppression, Help dialog listing | KEY-1 | 0.75 | P2-1 |
| P2-4 | Clipboard: copy/cut/paste/duplicate with offset; system image paste; plain-text paste creates text | KEY-2 | 1 | P2-1, P1-3 |
| P2-5 | Nudge with arrows and Shift+arrows; honours grid when on | KEY-3 | 0.25 | P2-1 |
| P2-6 | Group/ungroup with double-click to enter group | SEL-2 | 0.75 | P2-1 |
| P2-7 | Lock/unlock; locked objects skip transformer and drag | SEL-3 | 0.25 | P2-1 |
| P2-8 | Z-order commands (four) | SEL-4 | 0.25 | P1-3 |
| P2-9 | Align and distribute (eight operations) | SEL-5 | 0.5 | P2-1 |
| P2-10 | Context menu (`ui/ContextMenu.js`) wired to all of the above | SEL-6 | 0.5 | P2-4..9 |

**AC:** every shortcut in Appendix B passes an e2e test; marquee selects only fully or partially enclosed objects per a setting; copy-paste of a group preserves structure.

**P2-1 status: done.** `canvas/Selection.js` (a plain `Set`-based model - `selectOnly`/`toggle`/`add`/`remove`/`set`/`clear`, with `primary` tracking the most-recently-selected shape for the properties panel's single-shape UI) plus `CanvasManager` wiring: shift-click emits a new `"shapeToggled"` event (kept separate from `"shapeSelected"`, which always replaces the whole selection) and `_syncTransformer()` keeps `transformer.nodes([...])` in sync with the selection on every change. The one real bug: an early draft hand-rolled multi-shape drag by tracking each selected shape's drag-start position and re-applying the same delta on `dragmove` - this duplicated a feature Konva's own `Transformer` already implements internally (`_proxyDrag`, wired automatically the moment `transformer.nodes([...])` includes more than one node, which `_syncTransformer` already does on every selection change) and fought with it, compounding into visibly wrong movement under a real mouse drag. Found by reading Konva's own source after a Playwright-driven real drag landed shapes tens of pixels off from where the mouse actually went - a synthetic `shape.fire("dragmove")` unit test could not have caught this, since Konva's real drag registration (which `Transformer`'s own proxying depends on) needs actual pointer events. Fixed by deleting the custom logic entirely and relying on Konva's own. 9 new unit tests (`Selection.test.js`), 7 new e2e tests (`selection.spec.js`, including a real-mouse-drag regression test for the bug above).

**P2-2 status: done.** `canvas/Marquee.js` (pure geometry: `normalizeRect`, and `shapesInMarquee` with a selectable `"intersect"` (default, any overlap) or `"contain"` (fully enclosed) mode) plus `ToolManager._bindMarqueeSelect`, drawing a dashed `Rect` on the new `guidesLayer` while dragging on empty canvas in the select tool. The one real bug: a freshly-drawn marquee's selection was immediately wiped by the trailing click that ends the drag - Konva fires `"click"` on the *stage background* (unlike a shape, which suppresses it on any real movement) *before* invoking `"mouseup"` listeners for that same background case, the reverse of the ordering a first attempt assumed. Found by adding temporary `console.log`s and rebuilding, not by reasoning from the docs. Fixed by moving the click-suppression flag's assignment from the `mouseup` handler into `mousemove`, set the instant the marquee rect is first created (so it is already true by the time the reversed-order click fires) rather than at drag-end. 10 new unit tests (`Marquee.test.js`), 6 new e2e tests (`marquee.spec.js`). Scope decision: the AC's "per a setting" is not fully met - `shapesInMarquee`'s `"contain"` mode exists and is unit-tested, but nothing in the UI exposes a setting to switch to it yet (no settings panel exists anywhere in the app); `ToolManager` always calls it with the default `"intersect"` mode. Documented here rather than silently claimed as complete; wiring an actual toggle is cheap once Phase 5+'s settings surface (or any settings UI) exists.

**P2-3 status: done.** `ui/shortcuts-data.js` (`SHORTCUT_GROUPS`, the single source of truth consumed by both `ui/Shortcuts.js`'s real key handling and `ui/HelpDialog.js`'s "?" reference listing, so the two can never drift apart) plus tool/shape single-letter shortcuts (V/P/N/T/R/O/L, each just calling the same method its toolbar button does), `Shift+1` zoom-to-fit, and the Help modal itself. Zoom-to-fit reads `e.code === "Digit1"` rather than `e.key`, since `e.key` for Shift+1 is `"!"` on a standard US layout (the character Shift actually produces), which would make the shortcut layout-dependent - `e.code` identifies the physical key regardless. The one real bug, caught while writing e2e coverage before committing (not after): the initial "?" handler wasn't gated by the same `typing` check every other shortcut uses, on the reasoning that "nobody types a literal '?' meaningfully" - wrong, since a shape named "What is this?" would pop the Help dialog on every keystroke. Fixed by adding the same `&& !typing` guard. 14 new unit tests (`HelpDialog.test.js`), 7 new e2e tests (`shortcuts.spec.js`). Scope decision (documented in `shortcuts-data.js`'s own header comment): deliberately not the PRD's full Appendix B - excludes shortcuts for Hand/pan, Highlighter/Eraser, Arrow/Connector, group/ungroup, lock/unlock, z-order, grid/snap toggle and zoom-to-selection, none of which this app has a feature behind yet; each lands in the same table as the task that actually builds it ships, not before.

**P2-4 status: done.** `canvas/Clipboard.js` (a small in-memory store for copy/cut, deep-cloning on both `write` and `read` so neither a later mutation nor a repeated paste can corrupt what's stored) plus four new `CanvasManager` methods - `copySelection`/`cutSelection`/`duplicateSelection`/`pasteClipboard` - built on the same `toStorageShape`/`reconstructShapes` bridge P1-1 already uses for save/load and JSON import, rather than a second shape-serialization format. `reconstructShapes` gained an `onSettled(shape | null)` callback, threaded through every branch (including the two `return`-early ones, StickyNote and Image) so paste/duplicate know when every shape in a batch has actually landed - Image shapes load asynchronously via `Konva.Image.fromURL`, everything else is synchronous, and mixing the two is exactly why this couldn't just assume `reconstructShapes` was done when it returned. Only once every shape has settled does a paste/duplicate select the whole batch and emit one `"shapeAdded"`, the same single-checkpoint-per-batch reasoning P2-1's `removeShapes` already established. Scope decision on "system image paste": it is deliberately in-memory-only for this app's own shapes (`Clipboard.js`'s own header explains why - there is no OS clipboard format for an arbitrary shape, so cross-app copy of a FrameX shape was never a realistic goal); pasting an actual image or plain text copied from *outside* the app goes through a separate native `"paste"` DOM event listener in `main.js` instead, since only that event exposes `clipboardData` (a keydown handler never sees it) - it prefers this app's own clipboard when both could apply. A pasted image is embedded directly as a `data:` URL (`imageSrc`, alongside the existing bundled-icon `iconFile` - a shape carries one or the other) and capped to 400px on-canvas display size so a full-resolution screenshot doesn't dwarf the canvas; the pixels themselves stay full-resolution rather than actually being re-encoded smaller, and no document-size warning exists yet - real downscaling-on-insert and that warning are P6-2's stated job, not this one's, called out as such in `ShapeManager`'s own comment rather than silently included or silently skipped. 19 new unit tests (6 `Clipboard.test.js`, 13 `CanvasManager.test.js` covering the clipboard methods and `onSettled`'s ordering/async semantics), 7 new e2e tests (`clipboard.spec.js`), two of which drive the OS-clipboard image/text paths via a synthetic `ClipboardEvent`/`DataTransfer` rather than a real system clipboard - Playwright/CI has no reliable way to seed the latter with actual image bytes.

**P2-5 status: done.** `CanvasManager.nudgeSelection(dx, dy)` plus a small `NUDGE_DELTAS` table in `ui/Shortcuts.js` mapping the four arrow keys to a unit vector, scaled by 1 or (with Shift held) 10 at the call site. Moves every selected shape by the same delta and emits one `"shapeNudged"`, not once per shape - the same single-emission-per-batch reasoning as `removeShapes`/paste, since a multi-selection nudge should still undo in one step. `"shapeNudged"` is wired into `main.js`'s existing `debouncedHistoryCommit` (the same debounce a drag's own `"shapeDragEnded"` already uses), so holding an arrow key down and firing many nudges in quick succession still commits a single undo checkpoint rather than one per keystroke - verified by an e2e test that presses ArrowRight three times and undoes it in one `Ctrl+Z`. Only prevents the key's default behavior when something is actually selected (mirroring the existing Delete/Backspace shortcut), so an arrow key with nothing selected still does whatever it would do natively. Scope decision: the task's other stated half, "honours grid when on," is not implemented - this app has no grid/snap feature at all yet (the same standing exclusion already noted for marquee-select's "per a setting" and in `shortcuts-data.js`'s own header), so a nudge always moves by a plain 1px/10px; wiring an actual grid step is for whichever task first adds a grid. 4 new unit tests (`CanvasManager.test.js`), 7 new e2e tests (`nudge.spec.js`).

---

## Phase 3: Complete shape library and properties panel (5 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P3-1 | `shapes/registry.js`: one definition per type (factory, default style, anchors, label rules, transformer constraints) | SHP-1 | 1 | P1-2 |
| P3-2 | Implement all 17 shape types from PRD SHP-1 (arrow, polyline, curved arrow, rounded square, ellipse, diamond, star, hexagon, speech bubble, arrowed box, cylinder, document, plus existing) | SHP-1 | 1.5 | P3-1 |
| P3-3 | Draw-to-size for every shape tool with Shift constraint; click inserts default | SHP-2 | 0.75 | P3-2 |
| P3-4 | Vertex editing for polyline and curved arrow | SHP-3 | 0.75 | P3-2 |
| P3-5 | Rebuild `ui/PropertiesPanel.js` as the single source of properties: fill, stroke, width, opacity, corner radius, dash, shadow, arrowheads, recent colours, presets; works on multi-selection (mixed shows blank) | SHP-4 | 1 | P2-1 |
| P3-6 | Automated dead-control check: test that every `button[id]` in `canvas.html` has a listener | Metrics | 0.1 | P3-2 |

**AC:** every shapes-menu button creates its shape; properties changes are undoable and apply to all selected objects.

---

## Phase 4: Connectors (6 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P4-1 | Connector data model in `Document`: `{ id, from: {objectId, anchor}, to: {objectId, anchor} \| {x,y}, style, routing, label }` | CON-1 | 0.5 | P1-1 |
| P4-2 | Anchors from the shape registry (t/r/b/l, correct for centred shapes like Circle and for scaled Images) with hover rendering in connector mode | CON-2 | 0.75 | P3-1 |
| P4-3 | Connector tool: drag from anchor or body to target; free-end connectors; snap to nearest anchor | CON-1, CON-5 | 1 | P4-2, P2-1 |
| P4-4 | Renderer: dedicated connectors layer, straight router updating on every drag frame; delete cascades | CON-3 | 0.75 | P4-1 |
| P4-5 | Orthogonal router with endpoint-shape obstacle avoidance, computed on drag end; curved (bezier) router | CON-4 | 1.5 | P4-4 |
| P4-6 | Connector styling: arrowheads, dash, width, colour; label at midpoint that stays upright | CON-4 | 0.75 | P3-5, P4-4 |
| P4-7 | Connector selection and reconnection by dragging an endpoint handle | CON-3 | 0.75 | P4-3 |

**AC:** chain of three shapes with each routing style survives moving, resizing, rotating and deleting the middle shape; 200 connectors stay at 60 fps during drag.

---

## Phase 5: Canvas navigation, grid, snapping and guides (5 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P5-1 | Infinite canvas: stage pans; Space+drag, middle-mouse, hand tool | NAV-1 | 0.75 | P2-1 |
| P5-2 | Zoom 5–800 % around pointer; pinch; editable zoom field; fit and zoom-to-selection | NAV-2 | 0.75 | P5-1 |
| P5-3 | Grid (dots/lines, spacing, unit label) drawn on a cached background layer | NAV-3 | 0.5 | P5-1 |
| P5-4 | Snap-to-grid for move and resize; Alt disables | NAV-3 | 0.5 | P5-3 |
| P5-5 | Smart guides for edges and centres with 5 px threshold, on the guides layer | NAV-4 | 1 | P5-1 |
| P5-6 | Rulers in current unit | NAV-5 | 0.5 | P5-3 |
| P5-7 | Minimap (optional toggle) | NAV-6 | 0.75 | P5-1 |
| P5-8 | Background colour options and export handling | NAV-7 | 0.25 | P1-5 |

**AC:** dragging near another object shows guides and snaps; grid and rulers stay aligned at every zoom; pan/zoom state is not part of undo history.

---

## Phase 6: Images (2 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P6-1 | Image tool: file picker, drag-and-drop, paste; formats per IMG-1 | IMG-1 | 0.5 | P2-4 |
| P6-2 | Downscale to max edge on insert; embed as data URL; document size indicator warning at 80 % | IMG-3, DOC-3 | 0.5 | P1-4 |
| P6-3 | Aspect-locked resize (Shift frees), opacity, crop handle | IMG-2 | 1 | P3-5 |

**AC:** a 12 MP photo inserts under one second and is stored under 1 MB; crop is undoable.

---

## Phase 7: Icons, text, notes, freehand (4 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P7-1 | Icon manifest and searchable, categorised icon panel; re-enable in UI | SHP-5 | 1 | P3-1 |
| P7-2 | Crisp icons: render SVG at device pixel ratio × scale, re-rasterise on transform end | SHP-5 | 0.5 | P7-1 |
| P7-3 | Add icon packs per Appendix A with `ATTRIBUTION.md` | SHP-5 | 0.75 | P7-1 |
| P7-4 | Text properties (font, size, bold, italic, underline, align, line height); auto-height | TXT-2 | 0.75 | P3-5 |
| P7-5 | Sticky note colours, auto-grow, padding on resize | TXT-3 | 0.5 | P7-4 |
| P7-6 | Labels on closed shapes (double-click) that follow transforms | TXT-4 | 0.5 | P3-1 |
| P7-7 | Pen width/colour, highlighter, eraser tool | SHP-6 | 0.5 | P0-5 |

**AC:** icons stay sharp at 800 %; shape labels stay centred after rotation; eraser removes a stroke in one click.

---

## Phase 8: Layers panel and documents (3 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P8-1 | `ui/ObjectList.js`: z-ordered list with select, rename, visibility, lock, drag reorder | LAY-1, LAY-2 | 1.5 | P2-7, P2-8 |
| P8-2 | Multi-document index in persistence; `ui/DocumentSwitcher.js` with create, rename, duplicate, delete (confirm) | DOC-4 | 1 | P1-4 |
| P8-3 | Six starter templates as v2 JSON; empty-state card and switcher offer them | EXP-6 | 0.5 | P8-2 |

**AC:** reordering in the list updates the canvas and undo; switching documents saves the current one first.

---

## Phase 9: Touch, responsive, theme (4 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P9-1 | Pointer-event unification for all tools; long-press multi-select; 44 px handles | TCH-1 | 1.5 | P2-1, P5-2 |
| P9-2 | Responsive layout under 900 px: bottom sheets, scrollable toolbar | TCH-2 | 1 | P3-5 |
| P9-3 | Stylus pressure for pen | TCH-3 | 0.25 | P7-7 |
| P9-4 | Dark/light UI theme with `prefers-color-scheme` and toggle; canvas background independent | UX-5 | 0.75 | – |
| P9-5 | iPad manual test pass and fixes | TCH-1 | 0.5 | P9-1 |

**AC:** Appendix C steps 1–4 pass on iPad with touch and with a stylus.

---

## Phase 10: Onboarding, help, accessibility, landing page, release (4 days)

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P10-1 | Coach-mark tour (four steps), skippable, re-runnable | UX-1 | 0.75 | P4-3, P1-8 |
| P10-2 | Help dialog (`?`) with shortcuts, guide link, version | UX-3 | 0.5 | P2-3 |
| P10-3 | Accessibility pass: labels, focus, keyboard nav for panels, contrast, screen-reader object summary | UX-4 | 1 | P8-1 |
| P10-4 | Landing page refresh: screenshots, feature list, `og:image`, JSON-LD, sitemap dates | UX-6 | 0.75 | all |
| P10-5 | Performance pass: 500 objects + 200 connectors benchmark, layer count audit, caching, bundle analysis | NFR | 0.75 | P4-5, P5-5 |
| P10-6 | Lighthouse ≥ 90 on both pages; release checklist; tag v2.0.0 | Metrics | 0.25 | all |

---

## Summary

**Phase 0 status: complete.** All ten tasks done, committed one per task on `claude/intelligent-dirac-xdd1h8`. It ran well over its original 4-day estimate (the per-task entries above total closer to 9), because thorough testing of each fix consistently surfaced more, and more serious, pre-existing bugs than a source read predicted — most notably P0-10, where fixing an ESLint `no-unused-vars` finding traced back to a duplicated, diverged event-wiring method that made undoing a drag on any basic shape delete it outright instead of moving it back. Every fix in the phase is covered by an automated regression test (17 unit + 23 e2e, all green from a clean `npm ci`); `docs/PRD.md` §4 has the full list of what was found, what was fixed, and the one claim that didn't hold up. The original day estimates below are left as originally written, for comparison, rather than revised after the fact.

| Phase | Days | Cumulative |
|---|---|---|
| 0 Foundation | 4 | 4 |
| 1 Document, export, import | 6 | 10 |
| 2 Selection, keyboard, clipboard | 5 | 15 |
| 3 Shapes and properties | 5 | 20 |
| 4 Connectors | 6 | 26 |
| 5 Navigation, grid, guides | 5 | 31 |
| 6 Images | 2 | 33 |
| 7 Icons, text, notes, pen | 4 | 37 |
| 8 Layers and documents | 3 | 40 |
| 9 Touch and theme | 4 | 44 |
| 10 Onboarding, a11y, release | 4 | 48 |

About 48 focused days. Phases 0 to 4 (26 days) deliver the product gap identified in the research: export, selection, complete shapes, connectors. Phases 5 to 10 are what make it "perfect" rather than "complete".

## Order of merging

Each phase is one pull request into `main` from a `feat/phase-N-*` branch, with CI green and the phase AC checked off in the PR description. Phase 0 must merge before any other branch starts, because the folder restructure touches every file.

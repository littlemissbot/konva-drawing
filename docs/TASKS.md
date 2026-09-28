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
| P0-8 | Test harness: Jest with jsdom and `canvas` mock; Playwright with Chromium (pre-installed) against `vite preview`; GitHub Actions workflow running lint, unit and e2e on push | `jest.config.js`, `playwright.config.js`, `.github/workflows/ci.yml`, `package.json` | 0.75 | – |
| P0-9 | Restructure into `core/`, `canvas/`, `ui/`, `export/` folders per PRD section 7; `main.js` becomes composition root; remove `window.*` globals in favour of a `FrameX` namespace | all of `src/js` | 0.75 | P0-2 |
| P0-10 | ESLint + Prettier config; fix all findings | repo root | 0.25 | P0-9 |

**AC:** all existing behaviour works; saved v1 drawings load; CI is green; `npm run build` under 150 kB gzipped JS.

---

## Phase 1: Document model, persistence, export and import (6 days)

Goal: nothing is ever lost, and every drawing can get out.

| ID | Task | PRD | Est | Dep |
|---|---|---|---|---|
| P1-1 | `core/Document.js`: v2 schema, `createId()`, validation, `migrate(v1→v2)` with fixtures from real saved data | DOC-1 | 1 | P0-9 |
| P1-2 | `core/Store.js`: in-memory document, `apply(change)`, change events; Renderer subscribes and patches Konva nodes incrementally | DOC-1 | 1.5 | P1-1 |
| P1-3 | `core/History.js`: command-based undo/redo (add, remove, updateAttrs, reorder, batch); replaces snapshot `HistoryManager`; 200-step limit | DOC-1 | 1 | P1-2 |
| P1-4 | `core/Persistence.js`: debounced atomic save, `localStorage` with IndexedDB fallback on quota error, status events (saving/saved/failed) | DOC-2, DOC-3 | 1 | P1-2 |
| P1-5 | Export PNG/JPEG: content bounding box, temporary stage reset, `pixelRatio` 1/2/3, transparent or background, padding, canvas-size cap with message | EXP-1 | 0.5 | P1-2 |
| P1-6 | Export PDF via jsPDF: fit-to-content and A4/Letter with scale-to-fit; selectable text layer from `Text` nodes (px→pt × 0.75) | EXP-2 | 0.5 | P1-5 |
| P1-7 | JSON export (`Ctrl+S`) and import (`Ctrl+O`, drag-and-drop file) with replace/merge choice | EXP-3 | 0.5 | P1-1 |
| P1-8 | Export dialog UI (`Ctrl+E`) with format, scale, background, selection-only options and a live preview thumbnail | EXP-1..3 | 0.5 | P1-5 |
| P1-9 | Print via hidden iframe with the PNG scaled to page | EXP-5 | 0.25 | P1-5 |
| P1-10 | Unsaved-change guard on `beforeunload` | DOC-5 | 0.1 | P1-4 |

**AC:** JSON round-trip identical; PNG at 3× of a 4000 px wide drawing exports or reports the cap; PDF text is selectable in Preview and Acrobat; quota failure shows a message and the document remains intact.

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

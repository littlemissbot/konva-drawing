# FrameX Product Requirements Document

Version 1.0 · 28 September 2026 · Status: draft for sign-off

FrameX is a browser-based whiteboard and diagramming tool built on Konva.js. It runs with no account, no install and no backend, and saves work locally. This document defines what "finished" means for the single-user product. It supersedes the checklist in `FeaturePlan.md`, which stays as historical context.

---

## 1. Vision and principles

**Vision.** The fastest way to put a clear diagram on screen and get it out again. Open the page, draw, export. No sign-up, no sync spinner, no learning curve.

**Principles.** Every requirement below is judged against these, in order.

1. **Nothing is lost.** Work is saved continuously, survives reloads, domain changes and browser limits, and can always be exported.
2. **Everything visible works.** No dead buttons, no half-features. If a control is on screen it does its job completely.
3. **Keyboard first, touch equal.** Every action has a shortcut. Every action works on a tablet.
4. **Precise by default.** Snapping, alignment and grids make tidy diagrams the easy path.
5. **Fast on modest hardware.** Sixty frames per second on a 2019 laptop with 500 objects on the canvas.
6. **Local first.** No feature requires a server. Collaboration is explicitly out of scope for this version.

---

## 2. Users

| Persona | Goal | What they need most |
|---|---|---|
| Engineer / analyst | Process flows, system layouts, factory floor sketches | Connectors, industrial icons, scale grid, PDF export |
| Educator / student | Explain a concept, submit a diagram | Speed, sticky notes, freehand, PNG export |
| Designer / PM | Wireframes and flows in a meeting | Shapes, text, alignment, quick share of an image |
| Agency client (Redmonk) | Use the canvas embedded in a bespoke product | Clean init API, JSON document model, theming hooks |

---

## 3. Scope

### In scope (this PRD)

- Complete shape library with every menu item functional
- Selection model: single, multi, marquee, group, lock
- Full keyboard and clipboard support
- Connectors between shapes with anchors and live re-routing
- Canvas navigation: pan, zoom, fit, grid, snapping, alignment guides, rulers
- Text and sticky notes with reliable inline editing at any zoom
- Image upload and paste
- Layer order and object list
- Export: PNG, JPEG, PDF, JSON; import: JSON; print
- Robust persistence: versioned document format, multiple documents, storage limits handled
- Touch and mobile layout
- Onboarding, help, accessibility, performance and test coverage

### Out of scope (deferred)

- Real-time collaboration, accounts, cloud storage, shareable links
- SVG vector export (Konva has no native support; tracked as a future item)
- P&ID or standards-compliant engineering symbol sets
- AI features

---

## 4. Current state (baseline audit)

Verified against the source on the `claude/intelligent-dirac-xdd1h8` branch.

**Working:** rect, square, circle, triangle, line; 16 industrial SVG icons (panel disabled in UI); text with inline edit; sticky notes; freehand pen; single-select transformer with resize and rotate; undo/redo (snapshot based, 50 states); zoom buttons, wheel and Ctrl +/-/0; auto-save to `localStorage`; clear canvas; Google Analytics.

**Broken or missing (as of the original audit, 28 September 2026):**

- Shapes menu: `addArrow`, `addPolyline`, `addCurvedArrow`, `addRoundedSquare`, `addDiamond`, `addSpeechBubble`, `addArrowedBox` have no handlers, and none of their icon assets exist. `addStar` has both a button and a `ShapeManager.createStar` method but the two were never wired together. `addRectangle` had a handler but no matching button, so `createRectangle` was unreachable from the UI.
- Connectors: `CanvasManager.connections`, `updateConnections`, `getConnectionPoints` exist but nothing creates a connection; centre maths is wrong for `Circle` and scaled images.
- No Delete/Backspace, Escape, copy/paste, duplicate, select-all, arrow-key nudge.
- Only one node can be selected. No marquee, group, lock or z-order controls.
- No export of any kind. No import. No print.
- Saved SVG icons are persisted by absolute `image().src`, so drawings break on a domain change.
- Two load paths run on start (`autoLoad` and `checkAndRestoreCanvas`); a nested `DOMContentLoaded` listener never fires.
- Text editing textarea is positioned without accounting for stage scale and position, so editing while zoomed or panned misplaces it.
- Properties panel: `PropertyManager.updateForm` is disabled and references a `#textContent` input that is not in the HTML; live logic is duplicated in `main.js`.
- Icons are rasterised at 50 × 50 px by `Konva.Image.fromURL`, so they blur when enlarged.
- Zoom is clamped to 20 to 200 percent and zooms around the stage origin rather than the pointer.
- No tests. jQuery is a dependency but never imported. Bootstrap CSS was loaded from a CDN while Bootstrap JS was bundled from npm.
- `sitemap.xml` last modified 2024; no `og:image`.

**Found during Phase 0 implementation, not in the original audit.** Four more bugs surfaced while implementing and testing other Phase 0 fixes, each confirmed with a headless-browser (Playwright) check against the built app rather than assumed from source:

- The 16 SVG icon files under `src/assets/svgs/` were never copied into the production build at all. They are referenced only via a runtime-built string (`` `assets/svgs/${svgFile}` `` inside `SVGManager.createSVG`), which Vite's static asset scanner cannot see, so it never bundled or copied them. In a built/deployed app, `Konva.Image.fromURL` was fetching the SPA-fallback HTML (`content-type: text/html`) instead of an SVG, and silently failing to load, for every one of the 16 icons — independent of, and more fundamental than, the absolute-URL persistence bug the original audit flagged. This means the icon feature could not have worked in production even before this audit, regardless of the icon panel being disabled.
- `SVGManager.setupSVGEvents` calls `canvasManager.updateTooltip()` and `canvasManager.hideTooltip()` on every icon hover; neither method existed on `CanvasManager`, so hovering an icon threw an uncaught `TypeError`. The `tooltipLayer` these methods needed was already created and plumbed through by `main.js` but had never been used by anything.
- `Ctrl+Shift+Z` (the standard redo shortcut) silently did nothing. The handler compared `e.key === "z"`, but a `KeyboardEvent`'s `key` reports the Shift-modified character — `"Z"`, uppercase — once Shift is held, so that branch never matched. `Ctrl+Y` (the same action, different shortcut) worked, which is presumably why this went unnoticed. Found by an e2e test exercising the real shortcut rather than a hand-check of the "obvious" one; fixed by comparing case-insensitively.
- The most serious bug found in the whole phase: **dragging any basic shape (circle, rectangle, square, triangle, star, line — everything created from the shapes menu, the primary way users add shapes) and then pressing Ctrl+Z deleted the shape outright instead of moving it back.** `ShapeManager` held its own copy of `setupShapeEvents`, diverged from `CanvasManager`'s, missing the `dragend` → `"shapeDragEnded"` emission that commits a drag to the undo history; without it, a drag was never a distinct undo checkpoint, so undo fell back to the shape's last real checkpoint — its creation. Found by an ESLint `no-unused-vars` warning on a `name` parameter neither copy of the method used; tracing every call site (all of which pass a real label) to understand why turned up both the unused tooltip opportunity and the missing handler. Fixed by deleting the duplicate and routing every caller through one canonical implementation.

**Corrected from the original audit.** One claim in the first pass of this audit did not hold up under testing and is recorded here rather than silently dropped: freehand pen strokes were reported as permanently unselectable because they are created with `listening: false`. A headless-browser check (Playwright against the built app) showed this is wrong — `ToolManager._syncShapePointerMode()` re-enables `listening` and `draggable` on every shape, freehand strokes included, whenever the active tool changes. A stroke drawn with the pen tool becomes selectable, draggable and deletable as soon as the user switches to the select tool. No fix was needed; see `docs/TASKS.md` P0-5.

**Fixed in Phase 0** (see `docs/TASKS.md` for task IDs): jQuery removed, Bootstrap CSS self-hosted (P0-1); Rectangle and Star wired up, remaining unimplemented shape buttons hidden with a Phase 3 pointer instead of left dead (P0-6); Delete/Backspace/Escape shortcuts added, suppressed while typing (P0-7); text-editing overlay now sizes and rotates correctly at any zoom level and after panning, verified at 100% and 200% zoom (P0-4); SVG icons now ship in the production build, persist by relative filename instead of an absolute URL (with a migration fallback for old saves), and no longer crash on hover (P0-3); the three redundant startup/load paths collapsed into one (P0-2); a Jest unit suite and a Playwright end-to-end suite now cover all of the above, wired into GitHub Actions CI, and caught the `Ctrl+Shift+Z` redo bug above in the process (P0-8); `src/js` restructured into `core/`, `canvas/` and `ui/` (verified as a byte-identical build before and after the move), with the inline keyboard-shortcut listener extracted into its own `ui/Shortcuts.js` — full removal of the remaining `window.*` globals is deliberately left to Phase 1, where the PRD's own architecture direction already homes it (P0-9); ESLint and Prettier now cover the JS codebase and CI, and fixing what they flagged is what surfaced the drag-then-undo bug above and fixed it by deleting `ShapeManager`'s duplicate event wiring in favour of `CanvasManager`'s, which also gave every shape type the hover tooltip only SVG icons had before (P0-10).

---

## 5. Functional requirements

Each requirement has an ID for the task breakdown. Acceptance criteria are testable statements.

### 5.1 Document model and persistence (DOC)

**DOC-1 Versioned document format.** A FrameX document is JSON: `{ version: 2, id, name, createdAt, updatedAt, canvas: { background, gridSize, unit }, objects: [...], connectors: [...] }`. Each object has a stable `id`, `type`, geometry, style and `zIndex`. Image and icon references are relative asset keys or embedded data URLs, never absolute URLs.
Acceptance: a v1 `canvasData` blob loads through a migration and round-trips through export/import byte-for-byte after normalisation.

**DOC-2 Auto-save.** Every change persists within two seconds, with a visible status (Saving, Saved, Failed). Snapshots are written atomically (write to a temp key, then rename) so a crash mid-write never corrupts the document.

**DOC-3 Storage limits.** If `localStorage` write fails (quota), the app falls back to IndexedDB and tells the user. Embedded images are downscaled to a configurable max edge (default 2048 px) and re-encoded before storage.

**DOC-4 Multiple documents.** A document switcher lists local documents by name and last-edited time; users can create, rename, duplicate and delete documents. Delete asks for confirmation.

**DOC-5 Unsaved-change guard.** Navigating away while a save is pending prompts the browser confirmation.

### 5.2 Shapes (SHP)

**SHP-1 Every menu item works.** Line, Arrow, Polyline, Curved Arrow, Square, Rounded Square, Rectangle, Circle, Ellipse, Diamond, Star, Triangle, Hexagon, Speech Bubble, Arrowed Box (process arrow), Cylinder, Document (flowchart). Each creates a centred default at the viewport centre, is selected on creation and is undoable.

**SHP-2 Draw-to-size.** Selecting a shape tool then dragging on the canvas draws that shape from the drag rectangle. Shift constrains to 1:1. A single click without drag inserts the default size.

**SHP-3 Polyline and curve editing.** Polyline and curved arrow expose draggable vertex handles when selected; double-click on a segment adds a vertex; Delete on a selected vertex removes it.

**SHP-4 Style properties.** Fill, stroke colour, stroke width, opacity, corner radius (rect), dash pattern, shadow on/off, arrowheads (none, start, end, both) for lines and arrows. Recent colours palette (last 8) plus 12 preset swatches.

**SHP-5 Icon library.** Categorised, searchable icon panel with the existing 16 industrial icons plus expanded packs (see Appendix A). Icons are loaded as vector paths where possible and rasterised at device pixel ratio × scale so they stay crisp at any size.

**SHP-6 Freehand.** Pen strokes are selectable, deletable and movable like any object. Pen has width and colour. A highlighter variant with 50 percent opacity and multiply blend. Eraser tool removes whole strokes on hover-click.

### 5.3 Text and notes (TXT)

**TXT-1 Inline editing at any zoom.** The editing textarea matches the node's absolute position, scale and rotation. Verified at 20, 100 and 400 percent zoom and after panning.

**TXT-2 Text properties.** Font family (system stack plus Poppins), size, bold, italic, underline, alignment, line height, colour. Auto-height as the user types; manual width via transformer.

**TXT-3 Sticky notes.** Six colour presets, auto-growing text, resize keeps padding, text stays inside the note.

**TXT-4 Labels on shapes.** Double-clicking any closed shape adds a centred label that moves and rotates with the shape.

### 5.4 Selection and editing (SEL)

**SEL-1 Multi-select.** Shift-click adds to selection; click-drag on empty canvas draws a marquee; Ctrl/Cmd+A selects all. The transformer wraps all selected nodes and transforms them together.

**SEL-2 Group / ungroup.** Ctrl/Cmd+G groups, Shift+Ctrl/Cmd+G ungroups. Groups behave as a single object; double-click enters the group.

**SEL-3 Lock.** Locked objects cannot be moved, resized or deleted until unlocked from the context menu or object list.

**SEL-4 Z-order.** Bring to front, bring forward, send backward, send to back via shortcuts and context menu.

**SEL-5 Alignment and distribution.** Align left/centre/right/top/middle/bottom and distribute horizontally/vertically for two or more selected objects.

**SEL-6 Context menu.** Right-click on object or canvas shows cut, copy, paste, duplicate, delete, lock, z-order, align, group.

### 5.5 Keyboard and clipboard (KEY)

**KEY-1 Shortcut table.** See Appendix B. All shortcuts work on Windows, macOS and Linux keyboards, are suppressed while typing in an input, and are listed in a Help dialog opened with `?`.

**KEY-2 Clipboard.** Copy, cut, paste (with 10 px offset), duplicate (Ctrl/Cmd+D). Pasting an image from the system clipboard inserts it. Pasting plain text creates a text node.

**KEY-3 Nudge.** Arrow keys move the selection 1 px; Shift+arrow moves 10 px; both snap to grid when the grid is on.

### 5.6 Connectors (CON)

**CON-1 Connector tool.** Drag from one shape to another to create a connector. Connectors store only the two object IDs and anchor IDs, never copied positions.

**CON-2 Anchors.** Every closed shape exposes four anchors (top, right, bottom, left) that appear on hover in connector mode. Dropping on the shape body picks the nearest anchor.

**CON-3 Live re-routing.** Connectors update on every drag frame for straight lines and on drag end for orthogonal routes. Deleting either endpoint deletes the connector.

**CON-4 Routing styles.** Straight, orthogonal (Manhattan with obstacle avoidance of the two endpoint shapes at minimum), and curved. Arrowheads and labels as in SHP-4 and TXT-4.

**CON-5 Loose ends.** A connector can be drawn with a free end; the free end can later be dropped on a shape.

### 5.7 Canvas and navigation (NAV)

**NAV-1 Infinite canvas.** The drawable area is unbounded; the stage pans. Space+drag, middle-mouse drag, and two-finger drag pan. A hand tool exists for touch.

**NAV-2 Zoom.** 5 to 800 percent. Wheel and pinch zoom around the pointer; Ctrl/Cmd +/-/0; fit-to-content; zoom-to-selection. Zoom level is shown and editable.

**NAV-3 Grid and snap.** Toggleable dot or line grid with configurable spacing and a real-world unit label (px, cm, m). Snap-to-grid for move and resize. Snap can be held off with Alt.

**NAV-4 Smart guides.** While dragging, alignment guides appear for edges and centres of nearby objects and the canvas, with a 5 px snap threshold.

**NAV-5 Rulers.** Optional top and left rulers in the current unit.

**NAV-6 Minimap.** Optional minimap for documents larger than the viewport.

**NAV-7 Background.** White, light grey, dark, or a solid colour of choice; export honours or ignores the background by option.

### 5.8 Images (IMG)

**IMG-1 Upload.** Toolbar button, drag-and-drop onto the canvas, and paste. PNG, JPEG, GIF (first frame), WebP, SVG.

**IMG-2 Handling.** Images keep aspect ratio by default (Shift to free-resize), can be cropped with a crop handle, and have opacity.

**IMG-3 Size guard.** Images over the max edge are downscaled before insertion; a total-document size indicator warns at 80 percent of the storage budget.

### 5.9 Layers and object list (LAY)

**LAY-1 Object list.** A collapsible panel lists all objects in z-order with name, type icon, visibility and lock toggles. Clicking selects; drag reorders.

**LAY-2 Naming.** Objects have editable names; defaults are type plus counter, as today.

### 5.10 Export, import and print (EXP)

**EXP-1 PNG and JPEG.** Export the whole document or the selection at 1×, 2× or 3×, transparent or with background, with configurable padding. Uses `toDataURL` with a bounding box computed from content, not from the visible stage. Output size is capped to the browser canvas limit with a clear message when reduced.

**EXP-2 PDF.** Export via jsPDF sized to the content in px (`px_scaling` hotfix), with text nodes re-emitted as invisible selectable text. Page size options: fit to content, A4, Letter, landscape or portrait, with scale-to-fit.

**EXP-3 JSON.** Download the v2 document; import a v1 or v2 file via file picker or drag-and-drop, with a choice to replace or merge into the current document.

**EXP-4 Copy as image.** Copy the selection to the system clipboard as PNG.

**EXP-5 Print.** Print the current document scaled to the page.

**EXP-6 Templates.** Six starter templates (blank, flowchart, org chart, factory floor, mind map, wireframe) selectable from the empty-state card and the document switcher.

### 5.11 Touch and responsive (TCH)

**TCH-1 Touch parity.** Every tool works with touch: draw, select, multi-select (long-press then tap), drag, pinch zoom, two-finger pan, transformer handles sized 44 px minimum.

**TCH-2 Layout.** At widths under 900 px the side panels become bottom sheets, the toolbar collapses to a scrollable row, and the properties panel is a slide-up sheet.

**TCH-3 Stylus.** Pressure-sensitive pen width where `PointerEvent.pressure` is available.

### 5.12 Onboarding, help and accessibility (UX)

**UX-1 First run.** A four-step coach-mark tour (tools, shapes, connectors, export) that can be skipped and re-run from Help.

**UX-2 Empty state.** The existing "add first object" card offers templates and a short shortcut list.

**UX-3 Help.** `?` opens a dialog with the shortcut table, a link to a one-page guide, and the version number.

**UX-4 Accessibility.** All toolbar controls are buttons with labels and visible focus; panels are keyboard navigable; colour pickers accept typed hex values; contrast meets WCAG AA in both themes; a screen-reader summary of the object list exists.

**UX-5 Theme.** Light and dark UI themes following `prefers-color-scheme`, with a manual toggle.

**UX-6 Landing page.** Updated screenshots, feature list matching the shipped product, `og:image`, JSON-LD, current sitemap dates.

---

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | 60 fps drag with 500 objects and 200 connectors on a 2019 mid-range laptop; first interactive under 1.5 s on a 4G connection; JS bundle under 150 kB gzipped |
| Memory | At most 4 Konva layers (main, connectors, guides, transformer); `listening(false)` on guides and decorations; complex groups cached |
| Browser support | Last two versions of Chrome, Edge, Firefox, Safari; iPadOS Safari; Android Chrome |
| Persistence | No data loss across reload, tab close, browser crash, or quota error; documents survive a domain change |
| Privacy | No document data leaves the browser; analytics records events only, never content |
| Quality gate | Unit tests for document model, migrations, history, routing and export geometry; Playwright end-to-end tests for every requirement group; lint and format checks in CI; zero console errors in production |
| Code health | Single source of truth for selection and properties; no window globals except a namespaced `FrameX` debug handle; no unused dependencies |

---

## 7. Architecture direction

Keep Konva. Restructure around a document store so the canvas becomes a renderer of state rather than the state itself.

```
src/js/
  core/
    Document.js        # v2 schema, ids, migrations, validation
    Store.js           # in-memory document + change events (single source of truth)
    History.js         # command-based undo/redo (replaces snapshot diffs)
    Persistence.js     # localStorage / IndexedDB adapter, atomic writes, multi-doc index
  canvas/
    Renderer.js        # document -> Konva nodes, incremental updates
    Selection.js       # selection set, marquee, transformer wiring
    Tools/             # Select, Pan, Pen, Highlighter, Eraser, Shape, Text, Note, Connector, Image
    Connectors/        # anchors, straight/orthogonal/curved routers
    Guides.js          # grid, snapping, smart guides, rulers
  ui/
    Toolbar.js, ShapesMenu.js, PropertiesPanel.js, ObjectList.js, ContextMenu.js,
    DocumentSwitcher.js, ExportDialog.js, HelpDialog.js, Tour.js, Theme.js
  export/
    raster.js, pdf.js, json.js, print.js
  shapes/
    registry.js        # one definition per shape type: factory, anchors, default style, label rules
  icons/
    manifest.json      # categories, search terms, relative paths
  main.js              # composition root only
```

Selection, properties and tool state move out of `main.js` and the `window` globals. `HistoryManager` changes from whole-document snapshots to commands (add, remove, update attrs, reorder) so 500-object documents undo instantly and memory stays flat.

**This is the end-state across the whole roadmap, not a single phase's task list.** `core/Document.js` (schema, ids, migration, validation) is real as of Phase 1 — see `docs/TASKS.md`. `Store.js`, `History.js`'s command rewrite, and `Renderer.js` are deliberately deferred past Phase 1: their payoff is mostly about enabling collaboration and a much larger shape registry later, not anything Phase 1's actual requirements (DOC-1 through DOC-5, EXP-1 through EXP-6) need, since export, import and persistence are all directly implementable against the existing `CanvasManager.shapes` array and Konva `Stage` — which is exactly what Phase 1 does. `docs/TASKS.md`'s Phase 1 section has the fuller reasoning. Until that rewrite happens, `HistoryManager`'s existing snapshot-based undo/redo (well covered by tests as of Phase 0's P0-10) is the real mechanism, not a placeholder.

---

## 8. Success metrics

- Zero dead controls (automated check: every `button[id]` in `canvas.html` has a bound handler).
- 100 percent of shortcuts in Appendix B pass an end-to-end test.
- Export round-trip: JSON export → import produces an identical document.
- Lighthouse performance and accessibility scores of 90 or above on `canvas.html` and `index.html`.
- Manual test plan (Appendix C) passes on desktop Chrome, Safari and iPad.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Orthogonal routing complexity | Ship straight connectors first; orthogonal routing computed on drag end only; obstacle set limited to endpoint shapes initially |
| Canvas size limits on export | Cap pixel ratio automatically; tile export as a later enhancement |
| Storage quota with images | Downscale on insert, IndexedDB fallback, size indicator |
| Refactor breaks existing saved drawings | v1 migration with fixtures from real saved data; migration tests |
| Scope creep | Each phase ships independently and is usable; PRD change requires updating this document |

---

## Appendix A: Icon library plan

Existing: 16 industrial icons. Target categories (each 20 to 40 icons, MIT or CC0 sources such as Tabler, Lucide, or Flaticon free packs with attribution recorded in `ATTRIBUTION.md`):
industrial and manufacturing (expand), logistics and warehouse, flowchart symbols, UML and network basics, office and people, education and science, arrows and callouts.

## Appendix B: Keyboard shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Select tool | V | V |
| Hand / pan tool | H, or hold Space | H, or hold Space |
| Pen | P | P |
| Highlighter | Shift+P | Shift+P |
| Eraser | E | E |
| Rectangle | R | R |
| Ellipse | O | O |
| Line | L | L |
| Arrow | A | A |
| Connector | C | C |
| Text | T | T |
| Sticky note | N | N |
| Image | I | I |
| Delete selection | Delete / Backspace | Delete / Backspace |
| Deselect / cancel tool | Esc | Esc |
| Select all | Ctrl+A | Cmd+A |
| Copy / Cut / Paste | Ctrl+C / X / V | Cmd+C / X / V |
| Duplicate | Ctrl+D | Cmd+D |
| Undo / Redo | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | Cmd+Z / Cmd+Shift+Z |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G | Cmd+G / Cmd+Shift+G |
| Lock / Unlock | Ctrl+L | Cmd+L |
| Bring forward / Send backward | Ctrl+] / Ctrl+[ | Cmd+] / Cmd+[ |
| Bring to front / Send to back | Ctrl+Shift+] / Ctrl+Shift+[ | Cmd+Shift+] / Cmd+Shift+[ |
| Nudge / Nudge 10 px | Arrows / Shift+Arrows | Arrows / Shift+Arrows |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 | Cmd+= / Cmd+- / Cmd+0 |
| Zoom to fit / to selection | Shift+1 / Shift+2 | Shift+1 / Shift+2 |
| Toggle grid / snap | Ctrl+' / Ctrl+Shift+' | Cmd+' / Cmd+Shift+' |
| Export dialog | Ctrl+E | Cmd+E |
| Save JSON | Ctrl+S | Cmd+S |
| Open JSON | Ctrl+O | Cmd+O |
| Help | ? | ? |

## Appendix C: Manual test plan (summary)

1. Create one of every shape; resize, rotate, restyle, undo each step.
2. Connect three shapes in a chain with each routing style; move the middle shape; delete it.
3. Type a paragraph in a text node at 400 percent zoom after panning; edit a sticky note at 25 percent.
4. Marquee-select ten objects, group, align, distribute, lock, attempt to move, unlock, ungroup.
5. Paste an image from the clipboard; drop a 12 MP photo; confirm downscale and the size indicator.
6. Export PNG at 3×, PDF A4 landscape, JSON; reload the page; import the JSON into a new document.
7. Fill storage with large images until quota is hit; confirm fallback message and no data loss.
8. Repeat steps 1 to 4 on an iPad with touch and with a stylus.
9. Switch to dark theme; run the tour; open Help; verify every shortcut listed works.
10. Load a v1 `canvasData` fixture and confirm it migrates and renders identically.

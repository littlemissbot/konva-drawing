/**
 * The single source of truth for this app's keyboard shortcuts
 * (docs/TASKS.md P2-3), consumed by both ui/Shortcuts.js's actual key
 * handling and ui/HelpDialog.js's "?" reference listing, so the two
 * can never drift apart - a shortcut shown in the dialog is guaranteed
 * to be one Shortcuts.js (or ToolManager, for the marquee's own
 * shift-click/shift-drag; or main.js's own "paste" listener, for Paste
 * below - docs/TASKS.md P2-4 needs the native paste DOM event's
 * clipboardData, which a keydown handler never sees) really binds.
 *
 * This is deliberately NOT the PRD's full Appendix B table. Appendix B
 * also lists shortcuts for tools and features this app doesn't have
 * yet at all - Hand/pan (NAV-1), Highlighter and Eraser (no such
 * tools), Arrow and Connector (no such shape/tool - Phase 3/4),
 * z-order (P2-8), grid/snap toggle (no grid feature - NAV-3), zoom-to-
 * selection (no such zoom mode yet). Nudge (below) also has no grid/
 * snap to honour yet for the same reason - it always moves by a plain
 * 1px/10px. Listing
 * those here and in the Help dialog would tell a user a shortcut does
 * something when pressing it currently does nothing at all - worse
 * than not mentioning it. Each of those lands in this same table (and
 * gets bound in Shortcuts.js) as the task that actually builds the
 * feature behind it is done, not before.
 *
 * "Mod" means Ctrl on Windows/Linux, Cmd (⌘) on macOS - substituted for
 * the reader's actual platform at render time (ui/HelpDialog.js's
 * formatKeys), never baked in here.
 */
export const SHORTCUT_GROUPS = [
  {
    title: "Tools",
    shortcuts: [
      { action: "Select tool", keys: "V" },
      { action: "Pencil", keys: "P" },
      { action: "Sticky note", keys: "N" },
      { action: "Text", keys: "T" },
      { action: "Rectangle", keys: "R" },
      { action: "Ellipse", keys: "O" },
      { action: "Line", keys: "L" },
    ],
  },
  {
    title: "Selection",
    shortcuts: [
      { action: "Select all", keys: "Mod+A" },
      { action: "Delete selection", keys: "Delete / Backspace" },
      { action: "Deselect / cancel tool", keys: "Esc" },
      { action: "Nudge selection", keys: "Arrow keys" },
      { action: "Nudge selection (10px)", keys: "Shift+Arrow keys" },
      { action: "Group selection", keys: "Mod+G" },
      { action: "Ungroup", keys: "Mod+Shift+G" },
      { action: "Lock / unlock selection", keys: "Mod+L" },
    ],
  },
  {
    title: "Clipboard",
    shortcuts: [
      { action: "Copy", keys: "Mod+C" },
      { action: "Cut", keys: "Mod+X" },
      { action: "Paste", keys: "Mod+V" },
      { action: "Duplicate", keys: "Mod+D" },
    ],
  },
  {
    title: "Undo / redo",
    shortcuts: [
      { action: "Undo", keys: "Mod+Z" },
      { action: "Redo", keys: "Mod+Y or Mod+Shift+Z" },
    ],
  },
  {
    title: "Zoom",
    shortcuts: [
      { action: "Zoom in", keys: "Mod+=" },
      { action: "Zoom out", keys: "Mod+-" },
      { action: "Reset zoom", keys: "Mod+0" },
      { action: "Zoom to fit", keys: "Shift+1" },
    ],
  },
  {
    title: "File",
    shortcuts: [
      { action: "Export dialog", keys: "Mod+E" },
      { action: "Save as JSON", keys: "Mod+S" },
      { action: "Open a JSON file", keys: "Mod+O" },
      { action: "Print", keys: "Mod+P" },
    ],
  },
  {
    title: "Help",
    shortcuts: [{ action: "Show this dialog", keys: "?" }],
  },
];

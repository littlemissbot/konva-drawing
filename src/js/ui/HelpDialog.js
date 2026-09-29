/**
 * The "?" Help dialog's content (docs/TASKS.md P2-3): plain string/data
 * transforms over ui/shortcuts-data.js's SHORTCUT_GROUPS, kept separate
 * from the actual modal DOM wiring in main.js the same way export/
 * pdf.js's buildPrintDocument-style helpers are - so it's unit-testable
 * without a real Bootstrap modal or browser.
 */

/** True on macOS (and iPadOS reporting as a Mac), where shortcuts show
 * ⌘ instead of Ctrl. Takes a navigator-like object so it's testable
 * without depending on the real global `navigator` - main.js's own call
 * site omits the argument and gets the real one. */
export function detectMac(
  nav = typeof navigator !== "undefined" ? navigator : {}
) {
  const platform = nav.platform || "";
  const userAgent = nav.userAgent || "";
  return /Mac|iPod|iPhone|iPad/.test(platform) || /Mac OS X/.test(userAgent);
}

/** Substitutes the platform-appropriate modifier symbol for the literal
 * "Mod" placeholder in a shortcuts-data.js `keys` string - never baked
 * into the data itself, since which symbol is correct depends on who's
 * reading it. */
export function formatKeys(keys, isMac) {
  return keys.replace(/Mod/g, isMac ? "⌘" : "Ctrl");
}

/** SHORTCUT_GROUPS with every shortcut's `keys` resolved for the given
 * platform - the shape the dialog's own rendering (or a test asserting
 * on structure rather than an HTML string) actually wants. */
export function buildShortcutSections(groups, isMac) {
  return groups.map((group) => ({
    title: group.title,
    shortcuts: group.shortcuts.map((shortcut) => ({
      action: shortcut.action,
      keys: formatKeys(shortcut.keys, isMac),
    })),
  }));
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]
  );
}

/** The Help modal body's inner HTML, grouped and already platform-
 * resolved (pass buildShortcutSections' own output). */
export function renderShortcutsHtml(sections) {
  return sections
    .map(
      (section) => `
<div class="shortcuts-group">
  <h6>${escapeHtml(section.title)}</h6>
  <table class="shortcuts-table">
    <tbody>
      ${section.shortcuts
        .map(
          (shortcut) =>
            `<tr><td>${escapeHtml(shortcut.action)}</td><td><kbd>${escapeHtml(shortcut.keys)}</kbd></td></tr>`
        )
        .join("\n      ")}
    </tbody>
  </table>
</div>`
    )
    .join("\n");
}

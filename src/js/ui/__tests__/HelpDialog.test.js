import {
  detectMac,
  formatKeys,
  buildShortcutSections,
  renderShortcutsHtml,
} from "../HelpDialog.js";

describe("detectMac", () => {
  test("true for a Mac platform string", () => {
    expect(detectMac({ platform: "MacIntel", userAgent: "" })).toBe(true);
  });

  test("true for an iPad reporting as Mac in userAgent only", () => {
    expect(
      detectMac({
        platform: "",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      })
    ).toBe(true);
  });

  test("false for Windows", () => {
    expect(detectMac({ platform: "Win32", userAgent: "Windows NT 10.0" })).toBe(
      false
    );
  });

  test("false for Linux", () => {
    expect(
      detectMac({ platform: "Linux x86_64", userAgent: "X11; Linux" })
    ).toBe(false);
  });

  test("defaults to a falsy-safe result when given nothing", () => {
    expect(detectMac({})).toBe(false);
  });
});

describe("formatKeys", () => {
  test("substitutes Mod with the Mac symbol", () => {
    expect(formatKeys("Mod+A", true)).toBe("⌘+A");
  });

  test("substitutes Mod with Ctrl elsewhere", () => {
    expect(formatKeys("Mod+A", false)).toBe("Ctrl+A");
  });

  test("substitutes every occurrence of Mod, not just the first", () => {
    expect(formatKeys("Mod+Y or Mod+Shift+Z", false)).toBe(
      "Ctrl+Y or Ctrl+Shift+Z"
    );
  });

  test("a string with no Mod placeholder is unchanged", () => {
    expect(formatKeys("Delete / Backspace", true)).toBe("Delete / Backspace");
  });
});

describe("buildShortcutSections", () => {
  const groups = [
    {
      title: "Tools",
      shortcuts: [{ action: "Select tool", keys: "V" }],
    },
    {
      title: "Selection",
      shortcuts: [{ action: "Select all", keys: "Mod+A" }],
    },
  ];

  test("resolves every shortcut's keys for the given platform, preserving structure", () => {
    expect(buildShortcutSections(groups, true)).toEqual([
      { title: "Tools", shortcuts: [{ action: "Select tool", keys: "V" }] },
      {
        title: "Selection",
        shortcuts: [{ action: "Select all", keys: "⌘+A" }],
      },
    ]);
  });

  test("does not mutate the original data", () => {
    buildShortcutSections(groups, true);
    expect(groups[1].shortcuts[0].keys).toBe("Mod+A");
  });
});

describe("renderShortcutsHtml", () => {
  test("includes each section's title and every shortcut's action/keys", () => {
    const sections = [
      {
        title: "Tools",
        shortcuts: [{ action: "Select tool", keys: "V" }],
      },
    ];
    const html = renderShortcutsHtml(sections);
    expect(html).toContain("Tools");
    expect(html).toContain("Select tool");
    expect(html).toContain("<kbd>V</kbd>");
  });

  test("escapes HTML-significant characters in action/keys text", () => {
    const sections = [
      {
        title: "Test <script>",
        shortcuts: [{ action: "A & B", keys: "<>" }],
      },
    ];
    const html = renderShortcutsHtml(sections);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Test &lt;script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("<kbd>&lt;&gt;</kbd>");
  });

  test("produces valid, parseable markup for every group in shortcuts-data.js", async () => {
    const { SHORTCUT_GROUPS } = await import("../shortcuts-data.js");
    const sections = buildShortcutSections(SHORTCUT_GROUPS, false);
    const html = renderShortcutsHtml(sections);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelectorAll(".shortcuts-group")).toHaveLength(
      SHORTCUT_GROUPS.length
    );
    const totalShortcuts = SHORTCUT_GROUPS.reduce(
      (sum, g) => sum + g.shortcuts.length,
      0
    );
    expect(container.querySelectorAll("tr")).toHaveLength(totalShortcuts);
  });
});

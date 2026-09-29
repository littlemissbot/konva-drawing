import { Clipboard } from "../Clipboard.js";

describe("Clipboard", () => {
  test("hasContent is false until something is written", () => {
    const clipboard = new Clipboard();
    expect(clipboard.hasContent).toBe(false);
    expect(clipboard.read()).toBeNull();
  });

  test("write then read returns an equivalent copy of what was written", () => {
    const clipboard = new Clipboard();
    clipboard.write([{ type: "Circle", attrs: { x: 1, y: 2 } }]);
    expect(clipboard.hasContent).toBe(true);
    expect(clipboard.read()).toEqual([
      { type: "Circle", attrs: { x: 1, y: 2 } },
    ]);
  });

  test("read returns a fresh clone each time - mutating one result never affects a later read", () => {
    const clipboard = new Clipboard();
    clipboard.write([{ type: "Circle", attrs: { x: 1, y: 2 } }]);

    const first = clipboard.read();
    first[0].attrs.x = 999;
    first.push({ type: "Rect", attrs: {} });

    const second = clipboard.read();
    expect(second).toEqual([{ type: "Circle", attrs: { x: 1, y: 2 } }]);
  });

  test("write clones its input - mutating the original array/objects afterward doesn't affect what was stored", () => {
    const clipboard = new Clipboard();
    const items = [{ type: "Circle", attrs: { x: 1, y: 2 } }];
    clipboard.write(items);

    items[0].attrs.x = 999;
    items.push({ type: "Rect", attrs: {} });

    expect(clipboard.read()).toEqual([
      { type: "Circle", attrs: { x: 1, y: 2 } },
    ]);
  });

  test("a later write replaces the previous content entirely", () => {
    const clipboard = new Clipboard();
    clipboard.write([{ type: "Circle", attrs: {} }]);
    clipboard.write([
      { type: "Rect", attrs: {} },
      { type: "Star", attrs: {} },
    ]);

    expect(clipboard.read()).toEqual([
      { type: "Rect", attrs: {} },
      { type: "Star", attrs: {} },
    ]);
  });

  test("clear empties the clipboard", () => {
    const clipboard = new Clipboard();
    clipboard.write([{ type: "Circle", attrs: {} }]);
    clipboard.clear();

    expect(clipboard.hasContent).toBe(false);
    expect(clipboard.read()).toBeNull();
  });
});

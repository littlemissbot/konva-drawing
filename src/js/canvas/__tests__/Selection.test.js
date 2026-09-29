import { Selection } from "../Selection.js";

describe("Selection", () => {
  test("starts empty", () => {
    const sel = new Selection();
    expect(sel.size).toBe(0);
    expect(sel.shapes).toEqual([]);
    expect(sel.primary).toBeNull();
  });

  test("selectOnly replaces the whole selection with a single shape", () => {
    const sel = new Selection();
    const a = {};
    const b = {};
    sel.set([a, b]);
    sel.selectOnly(b);
    expect(sel.shapes).toEqual([b]);
    expect(sel.primary).toBe(b);
  });

  test("set replaces the whole selection with every shape given", () => {
    const sel = new Selection();
    const a = {};
    const b = {};
    const c = {};
    sel.selectOnly(a);
    sel.set([b, c]);
    expect(sel.shapes).toEqual([b, c]);
    expect(sel.has(a)).toBe(false);
  });

  test("toggle adds an unselected shape and removes an already-selected one", () => {
    const sel = new Selection();
    const a = {};
    sel.toggle(a);
    expect(sel.has(a)).toBe(true);
    sel.toggle(a);
    expect(sel.has(a)).toBe(false);
  });

  test("add unions a shape into the existing selection without clearing it", () => {
    const sel = new Selection();
    const a = {};
    const b = {};
    sel.selectOnly(a);
    sel.add(b);
    expect(sel.shapes.sort()).toEqual([a, b].sort());
  });

  test("remove drops one shape and leaves the rest", () => {
    const sel = new Selection();
    const a = {};
    const b = {};
    sel.set([a, b]);
    sel.remove(a);
    expect(sel.shapes).toEqual([b]);
  });

  test("clear empties the selection", () => {
    const sel = new Selection();
    sel.set([{}, {}]);
    sel.clear();
    expect(sel.size).toBe(0);
    expect(sel.primary).toBeNull();
  });

  test("primary is the most recently added shape, not selection order", () => {
    const sel = new Selection();
    const a = {};
    const b = {};
    const c = {};
    sel.set([a, b]);
    expect(sel.primary).toBe(b);
    sel.add(c);
    expect(sel.primary).toBe(c);
    // Removing the primary falls back to whatever's left, still in
    // insertion order - not undefined/stale.
    sel.remove(c);
    expect(sel.primary).toBe(b);
  });

  test("selecting the same shape twice never duplicates it", () => {
    const sel = new Selection();
    const a = {};
    sel.add(a);
    sel.add(a);
    expect(sel.shapes).toEqual([a]);
  });
});

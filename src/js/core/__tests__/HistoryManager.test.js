import { HistoryManager } from "../HistoryManager.js";

/**
 * HistoryManager is pure enough to unit test directly: it only touches
 * the DOM to enable/disable the undo/redo toolbar buttons, and jsdom
 * covers that. getSnapshot/applySnapshot are the same string-in,
 * string-out shape the real app uses (JSON.stringify'd canvas state),
 * but tests here just use plain counters/strings, since HistoryManager
 * itself never parses the snapshot - it only compares and stores it.
 */
describe("HistoryManager", () => {
  function makeManager(overrides = {}) {
    const applySnapshot = jest.fn();
    const manager = new HistoryManager({
      getSnapshot: () => "unused-default",
      applySnapshot,
      maxStates: 5,
      ...overrides,
    });
    return { manager, applySnapshot };
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="undoTool"></button>
      <button id="redoTool"></button>
    `;
  });

  test("reset() seeds a single state and disables both buttons", () => {
    const { manager } = makeManager();
    manager.reset("s0");
    expect(manager.states).toEqual(["s0"]);
    expect(manager.ptr).toBe(0);
    expect(document.getElementById("undoTool").disabled).toBe(true);
    expect(document.getElementById("redoTool").disabled).toBe(true);
  });

  test("reset() with no argument falls back to getSnapshot()", () => {
    const { manager } = makeManager({ getSnapshot: () => "from-getter" });
    manager.reset();
    expect(manager.states).toEqual(["from-getter"]);
  });

  test("commit() appends a new state and enables undo, not redo", () => {
    let snap = "s0";
    const { manager } = makeManager({ getSnapshot: () => snap });
    manager.reset("s0");
    snap = "s1";
    manager.commit();
    expect(manager.states).toEqual(["s0", "s1"]);
    expect(manager.ptr).toBe(1);
    expect(document.getElementById("undoTool").disabled).toBe(false);
    expect(document.getElementById("redoTool").disabled).toBe(true);
  });

  test("commit() is a no-op when the snapshot is unchanged", () => {
    const { manager } = makeManager({ getSnapshot: () => "same" });
    manager.reset("same");
    manager.commit();
    manager.commit();
    expect(manager.states).toEqual(["same"]);
    expect(manager.ptr).toBe(0);
  });

  test("commit() is a no-op while restoring (guards against re-entrant commits from applySnapshot)", () => {
    let snap = "s0";
    const { manager } = makeManager({ getSnapshot: () => snap });
    manager.reset("s0");
    manager.restoring = true;
    snap = "s1";
    manager.commit();
    expect(manager.states).toEqual(["s0"]);
  });

  test("commit() after undo() discards the redo branch (standard undo-tree truncation)", () => {
    let snap = "s0";
    const { manager } = makeManager({ getSnapshot: () => snap });
    manager.reset("s0");
    snap = "s1";
    manager.commit();
    snap = "s2";
    manager.commit();
    expect(manager.states).toEqual(["s0", "s1", "s2"]);

    manager.undo(); // ptr -> 1 ("s1")
    expect(manager.ptr).toBe(1);

    snap = "s1b"; // user made a new edit branching off s1
    manager.commit();
    expect(manager.states).toEqual(["s0", "s1", "s1b"]);
    expect(manager.ptr).toBe(2);
    // "s2" is gone: redo is no longer available past this new branch.
    expect(document.getElementById("redoTool").disabled).toBe(true);
  });

  test("commit() evicts the oldest state once maxStates is exceeded", () => {
    let snap = "s0";
    const { manager } = makeManager({ getSnapshot: () => snap, maxStates: 3 });
    manager.reset("s0");
    for (const s of ["s1", "s2", "s3", "s4"]) {
      snap = s;
      manager.commit();
    }
    // maxStates=3: only the 3 most recent survive.
    expect(manager.states).toEqual(["s2", "s3", "s4"]);
    expect(manager.ptr).toBe(2);
  });

  test("undo() applies the previous snapshot and updates toolbar state", () => {
    let snap = "s0";
    const { manager, applySnapshot } = makeManager({ getSnapshot: () => snap });
    manager.reset("s0");
    snap = "s1";
    manager.commit();

    manager.undo();
    expect(applySnapshot).toHaveBeenCalledWith("s0");
    expect(manager.ptr).toBe(0);
    expect(document.getElementById("undoTool").disabled).toBe(true);
    expect(document.getElementById("redoTool").disabled).toBe(false);
  });

  test("undo() at the oldest state is a no-op", () => {
    const { manager, applySnapshot } = makeManager();
    manager.reset("s0");
    manager.undo();
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(manager.ptr).toBe(0);
  });

  test("redo() re-applies a state that was undone", () => {
    let snap = "s0";
    const { manager, applySnapshot } = makeManager({ getSnapshot: () => snap });
    manager.reset("s0");
    snap = "s1";
    manager.commit();
    manager.undo();
    applySnapshot.mockClear();

    manager.redo();
    expect(applySnapshot).toHaveBeenCalledWith("s1");
    expect(manager.ptr).toBe(1);
    expect(document.getElementById("redoTool").disabled).toBe(true);
  });

  test("redo() at the newest state is a no-op", () => {
    const { manager, applySnapshot } = makeManager();
    manager.reset("s0");
    manager.redo();
    expect(applySnapshot).not.toHaveBeenCalled();
  });

  test("applySnapshot sets restoring=true only for the duration of the call, even if it throws", () => {
    let sawRestoringDuringApply = null;
    const manager = new HistoryManager({
      getSnapshot: () => "s1",
      applySnapshot: () => {
        sawRestoringDuringApply = manager.restoring;
        throw new Error("boom");
      },
    });
    manager.reset("s0");
    manager.commit(); // states: ["s0", "s1"], ptr=1
    expect(() => manager.undo()).toThrow("boom");
    expect(sawRestoringDuringApply).toBe(true);
    expect(manager.restoring).toBe(false); // cleared in the finally block
  });

  test("missing toolbar buttons do not throw (defensive optional chaining)", () => {
    document.body.innerHTML = ""; // no #undoTool / #redoTool in the DOM
    const { manager } = makeManager();
    expect(() => manager.reset("s0")).not.toThrow();
    expect(() => manager.commit()).not.toThrow();
  });
});

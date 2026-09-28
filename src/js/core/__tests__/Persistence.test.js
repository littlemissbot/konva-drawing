import "fake-indexeddb/auto";
import { Persistence } from "../Persistence.js";
import {
  STORAGE_KEY,
  createEmptyDocument,
  DocumentValidationError,
} from "../Document.js";

function quotaExceededError() {
  // Matches what browsers actually throw: a DOMException named
  // "QuotaExceededError". jsdom's localStorage doesn't enforce a real
  // quota, so the only way to test this path is to make setItem throw
  // one directly (see the tests that mock localStorage.setItem below).
  const e = new Error("The quota has been exceeded.");
  e.name = "QuotaExceededError";
  return e;
}

beforeEach(async () => {
  localStorage.clear();
  // fake-indexeddb keeps one shared in-memory database for the whole
  // process/file, not reset automatically between tests the way jsdom's
  // localStorage is reconstructed per test - clear it explicitly so an
  // earlier test's IndexedDB fallback write can't leak into a later one
  // (real timers here: this must finish before fake timers take over).
  await new Persistence().clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Persistence.scheduleSave / debouncing", () => {
  test("emits 'saving' immediately, writes only after the debounce elapses", async () => {
    const statuses = [];
    const p = new Persistence({
      debounceMs: 2000,
      onStatusChange: (s) => statuses.push(s),
    });
    const doc = createEmptyDocument();

    p.scheduleSave(doc);
    expect(statuses).toEqual([{ state: "saving" }]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await jest.advanceTimersByTimeAsync(1999);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // not yet

    await jest.advanceTimersByTimeAsync(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(doc);
    expect(statuses).toEqual([
      { state: "saving" },
      { state: "saved", backend: "localStorage" },
    ]);
  });

  test("repeated calls within the debounce window collapse into a single write", async () => {
    const statuses = [];
    const p = new Persistence({
      debounceMs: 2000,
      onStatusChange: (s) => statuses.push(s),
    });
    const doc = createEmptyDocument();

    p.scheduleSave({ ...doc, name: "A" });
    await jest.advanceTimersByTimeAsync(1000);
    p.scheduleSave({ ...doc, name: "B" });
    await jest.advanceTimersByTimeAsync(1000);
    p.scheduleSave({ ...doc, name: "C" });
    await jest.advanceTimersByTimeAsync(2000);

    // Only the last version was ever written; only one "saved" status.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).name).toBe("C");
    expect(statuses.filter((s) => s.state === "saved")).toHaveLength(1);
    // Only one "saving" too, since _saving stays true across the
    // collapsed calls (matches the app's existing autosave UX: the
    // indicator doesn't flicker on every keystroke).
    expect(statuses.filter((s) => s.state === "saving")).toHaveLength(1);
  });

  test("maxWaitMs forces a write during continuous activity that would otherwise keep resetting the debounce forever", async () => {
    const statuses = [];
    const p = new Persistence({
      debounceMs: 2000,
      maxWaitMs: 5000,
      onStatusChange: (s) => statuses.push(s),
    });
    const doc = createEmptyDocument();

    // Reschedule every 1000ms - always well inside the 2000ms debounce
    // window, so without maxWaitMs this would never flush.
    for (let i = 0; i < 8; i++) {
      p.scheduleSave({ ...doc, name: `v${i}` });
      await jest.advanceTimersByTimeAsync(1000);
    }

    // A write must have happened by t=5000 (maxWaitMs from the first
    // call at t=0), well before the 8000ms this loop runs for.
    expect(statuses.some((s) => s.state === "saved")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  test("saving the identical document again is a no-op write but still reports 'saved'", async () => {
    const statuses = [];
    const p = new Persistence({
      debounceMs: 100,
      onStatusChange: (s) => statuses.push(s),
    });
    const doc = createEmptyDocument();

    p.scheduleSave(doc);
    await jest.advanceTimersByTimeAsync(100);
    const writtenAtFirst = localStorage.getItem(STORAGE_KEY);

    p.scheduleSave(doc);
    await jest.advanceTimersByTimeAsync(100);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(writtenAtFirst);
    expect(statuses.filter((s) => s.state === "saved")).toHaveLength(2);
  });

  test("isSaving is true from scheduleSave until the write settles", async () => {
    const p = new Persistence({ debounceMs: 100 });
    expect(p.isSaving).toBe(false);

    p.scheduleSave(createEmptyDocument());
    expect(p.isSaving).toBe(true);

    await jest.advanceTimersByTimeAsync(100);
    expect(p.isSaving).toBe(false);
  });
});

describe("Persistence.saveNow", () => {
  test("writes immediately, bypassing the debounce", async () => {
    const p = new Persistence({ debounceMs: 60_000 });
    const doc = createEmptyDocument();
    await p.saveNow(doc);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(doc);
  });

  test("cancels a pending debounced save for an older version instead of writing it later", async () => {
    const p = new Persistence({ debounceMs: 5000 });
    p.scheduleSave({ ...createEmptyDocument(), name: "stale" });
    await p.saveNow({ ...createEmptyDocument(), name: "final" });

    // If the earlier debounce still fired later, this would overwrite
    // "final" with "stale".
    await jest.advanceTimersByTimeAsync(6000);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).name).toBe("final");
  });
});

describe("Persistence IndexedDB fallback on localStorage quota failure", () => {
  test("falls back to IndexedDB and reports that backend", async () => {
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw quotaExceededError();
      });
    const statuses = [];
    const p = new Persistence({
      debounceMs: 10,
      onStatusChange: (s) => statuses.push(s),
    });
    const doc = createEmptyDocument();

    await p.saveNow(doc);

    expect(statuses.at(-1)).toEqual({
      state: "saved",
      backend: "indexeddb",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // never landed there

    setItemSpy.mockRestore();

    // A fresh Persistence instance loading now (simulating a page
    // reload after a quota-triggered fallback save) must find it.
    const p2 = new Persistence();
    const result = await p2.load();
    expect(result.backend).toBe("indexeddb");
    expect(result.document).toEqual(doc);
  });

  test("reports 'failed' with the error when both backends fail", async () => {
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw quotaExceededError();
      });
    const originalIndexedDB = global.indexedDB;
    // Simulate IndexedDB also being unavailable (private browsing in
    // some browsers, or a corrupted database).
    global.indexedDB = undefined;

    const statuses = [];
    const p = new Persistence({
      debounceMs: 10,
      onStatusChange: (s) => statuses.push(s),
    });
    await p.saveNow(createEmptyDocument());

    expect(statuses.at(-1).state).toBe("failed");
    expect(statuses.at(-1).error).toBeInstanceOf(Error);

    setItemSpy.mockRestore();
    global.indexedDB = originalIndexedDB;
  });
});

describe("Persistence.load", () => {
  test("returns document: null when nothing has ever been saved", async () => {
    const p = new Persistence();
    expect(await p.load()).toEqual({
      document: null,
      migrated: false,
      backend: null,
    });
  });

  test("loads and migrates a legacy v1 blob from localStorage", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ shapes: [{ type: "Circle", attrs: { x: 1 } }] })
    );
    const p = new Persistence();
    const result = await p.load();
    expect(result.migrated).toBe(true);
    expect(result.backend).toBe("localStorage");
    expect(result.document.objects).toHaveLength(1);
  });

  test("loads a v2 document from localStorage without migrating", async () => {
    const doc = createEmptyDocument();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    const p = new Persistence();
    const result = await p.load();
    expect(result.migrated).toBe(false);
    expect(result.document).toEqual(doc);
  });

  test("throws rather than silently returning null when saved data is corrupt", async () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const p = new Persistence();
    await expect(p.load()).rejects.toThrow(SyntaxError);
  });

  test("throws DocumentValidationError for well-formed but unrecognized JSON", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nonsense: true }));
    const p = new Persistence();
    await expect(p.load()).rejects.toThrow(DocumentValidationError);
  });
});

describe("Persistence.clear", () => {
  test("removes the document from both backends", async () => {
    const p = new Persistence({ debounceMs: 10 });
    await p.saveNow(createEmptyDocument());
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await p.clear();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(await p.load()).toEqual({
      document: null,
      migrated: false,
      backend: null,
    });
  });

  test("cancels a pending debounced save instead of letting it write after clear", async () => {
    const p = new Persistence({ debounceMs: 5000 });
    p.scheduleSave(createEmptyDocument());
    await p.clear();

    await jest.advanceTimersByTimeAsync(6000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

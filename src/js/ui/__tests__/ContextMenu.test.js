import { Stage } from "konva/lib/Stage";
import { Layer } from "konva/lib/Layer";
import { Circle } from "konva/lib/shapes/Circle";
import { Group } from "konva/lib/Group";
import {
  buildContextMenuItems,
  renderContextMenuHtml,
  ContextMenu,
} from "../ContextMenu.js";
import { CanvasManager } from "../../canvas/CanvasManager.js";
import { EventBus } from "../../core/EventBus.js";
import { createId } from "../../core/Document.js";

/**
 * Runs against a real CanvasManager (same jest-canvas-mock setup
 * CanvasManager.test.js itself uses) rather than a hand-rolled stub, so
 * these tests exercise buildContextMenuItems' enablement logic against
 * the actual selection/clipboard/lock/group state it reads, not an
 * approximation of it.
 */
function setup() {
  window.eventBus = new EventBus();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const stage = new Stage({ container, width: 800, height: 600 });
  const mainLayer = new Layer();
  stage.add(mainLayer);
  const canvasManager = new CanvasManager(stage, mainLayer, new Layer());
  return {
    canvasManager,
    teardown: () => {
      stage.destroy();
      container.remove();
    },
  };
}

function findItem(items, id) {
  return items.find((item) => item.id === id);
}

describe("buildContextMenuItems", () => {
  test("with nothing selected and an empty clipboard, only nothing is enabled", () => {
    const { canvasManager, teardown } = setup();

    const items = buildContextMenuItems(canvasManager);

    const enabled = items.filter((i) => !i.separator && !i.disabled);
    expect(enabled).toEqual([]);
    teardown();
  });

  test("with one shape selected: selection-only actions enable, multi-only (align/group) stay disabled", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    const items = buildContextMenuItems(canvasManager);

    ["cut", "copy", "duplicate", "delete", "lock"].forEach((id) => {
      expect(findItem(items, id).disabled).toBe(false);
    });
    ["alignLeft", "distributeHorizontally", "group", "ungroup"].forEach(
      (id) => {
        expect(findItem(items, id).disabled).toBe(true);
      }
    );
    expect(findItem(items, "paste").disabled).toBe(true); // clipboard empty
    teardown();
  });

  test("with a clipboard that has content, Paste is enabled even with nothing selected", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    canvasManager.copySelection();
    canvasManager.deselectShape();

    const items = buildContextMenuItems(canvasManager);

    expect(findItem(items, "paste").disabled).toBe(false);
    expect(findItem(items, "cut").disabled).toBe(true); // nothing selected
    teardown();
  });

  test("with 2+ groupable shapes selected, Group enables and align/distribute enable", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    const items = buildContextMenuItems(canvasManager);

    expect(findItem(items, "group").disabled).toBe(false);
    expect(findItem(items, "alignLeft").disabled).toBe(false);
    expect(findItem(items, "distributeVertically").disabled).toBe(false);
    expect(findItem(items, "ungroup").disabled).toBe(true);
    teardown();
  });

  test("with 2 shapes where one isn't a groupable type, Group stays disabled", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const sticky = new Group({ toolType: "sticky", id: createId() });
    canvasManager.addShape(a);
    canvasManager.addShape(sticky);
    canvasManager.selection.set([a, sticky]);

    const items = buildContextMenuItems(canvasManager);

    expect(findItem(items, "group").disabled).toBe(true);
    // Align/distribute don't care about groupability, only count.
    expect(findItem(items, "alignLeft").disabled).toBe(false);
    teardown();
  });

  test("with a single real group selected, Ungroup enables and Group stays disabled", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);
    canvasManager.groupSelection();

    const items = buildContextMenuItems(canvasManager);

    expect(findItem(items, "ungroup").disabled).toBe(false);
    expect(findItem(items, "group").disabled).toBe(true);
    teardown();
  });

  test("with a single sticky note selected (also a Group), Ungroup stays disabled", () => {
    const { canvasManager, teardown } = setup();
    const sticky = new Group({ toolType: "sticky", id: createId() });
    canvasManager.addShape(sticky);
    canvasManager.selectShape(sticky);

    const items = buildContextMenuItems(canvasManager);

    expect(findItem(items, "ungroup").disabled).toBe(true);
    teardown();
  });

  test("Lock's label reflects whether the selection is already all locked", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    expect(findItem(buildContextMenuItems(canvasManager), "lock").label).toBe(
      "Lock"
    );

    canvasManager.toggleLockSelection();

    expect(findItem(buildContextMenuItems(canvasManager), "lock").label).toBe(
      "Unlock"
    );
    teardown();
  });

  test("z-order items enable with just a single shape selected (not multi-only)", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);

    const items = buildContextMenuItems(canvasManager);

    ["bringToFront", "bringForward", "sendBackward", "sendToBack"].forEach(
      (id) => {
        expect(findItem(items, id).disabled).toBe(false);
      }
    );
    teardown();
  });

  test("each item's action actually calls the matching CanvasManager method", () => {
    const { canvasManager, teardown } = setup();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    const b = new Circle({ x: 10, y: 10, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.addShape(b);
    canvasManager.selection.set([a, b]);

    const spy = jest.spyOn(canvasManager, "alignCenter");
    findItem(buildContextMenuItems(canvasManager), "alignCenter").action();
    expect(spy).toHaveBeenCalledTimes(1);
    teardown();
  });
});

describe("renderContextMenuHtml", () => {
  const items = [
    { id: "cut", label: "Cut", keys: "Mod+X", disabled: false },
    { id: "paste", label: "Paste", keys: "Mod+V", disabled: true },
    { id: "alignLeft", label: "Align Left", disabled: false }, // no keys
    { separator: true },
  ];

  test("renders one <li> per row, a <button> with data-item-id for actionable rows", () => {
    const html = renderContextMenuHtml(items, false);
    const container = document.createElement("ul");
    container.innerHTML = html;

    expect(container.querySelectorAll("li")).toHaveLength(4);
    const buttons = container.querySelectorAll("button[data-item-id]");
    expect(buttons).toHaveLength(3);
    expect(container.querySelector('[data-item-id="cut"]').disabled).toBe(
      false
    );
    expect(container.querySelector('[data-item-id="paste"]').disabled).toBe(
      true
    );
  });

  test("resolves Mod in a keys hint for the given platform", () => {
    expect(renderContextMenuHtml(items, true)).toContain("<kbd>⌘+X</kbd>");
    expect(renderContextMenuHtml(items, false)).toContain("<kbd>Ctrl+X</kbd>");
  });

  test("an item with no keys renders no <kbd>", () => {
    const html = renderContextMenuHtml(
      [{ id: "alignLeft", label: "Align Left", disabled: false }],
      false
    );
    expect(html).not.toContain("<kbd>");
  });

  test("escapes HTML-significant characters in a label", () => {
    const html = renderContextMenuHtml(
      [{ id: "x", label: "A & B <script>", disabled: false }],
      false
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("A &amp; B &lt;script&gt;");
  });
});

describe("ContextMenu (DOM wiring)", () => {
  function setupMenu() {
    const { canvasManager, teardown } = setup();
    const menuEl = document.createElement("ul");
    document.body.appendChild(menuEl);
    const contextMenu = new ContextMenu({ menuEl, canvasManager });
    return {
      canvasManager,
      menuEl,
      contextMenu,
      teardown: () => {
        menuEl.remove();
        teardown();
      },
    };
  }

  test("open() populates and shows the menu, positioned at the given coordinates", () => {
    const { menuEl, contextMenu, teardown } = setupMenu();

    contextMenu.open(50, 60);

    expect(menuEl.classList.contains("open")).toBe(true);
    expect(menuEl.style.left).toBe("50px");
    expect(menuEl.style.top).toBe("60px");
    expect(
      menuEl.querySelectorAll("button[data-item-id]").length
    ).toBeGreaterThan(0);
    teardown();
  });

  test("close() hides the menu and clears its content is not required, but the open class comes off", () => {
    const { menuEl, contextMenu, teardown } = setupMenu();
    contextMenu.open(0, 0);

    contextMenu.close();

    expect(menuEl.classList.contains("open")).toBe(false);
    teardown();
  });

  test("clicking an enabled item runs its action and closes the menu", () => {
    const { canvasManager, menuEl, contextMenu, teardown } = setupMenu();
    const a = new Circle({ x: 0, y: 0, radius: 5 });
    canvasManager.addShape(a);
    canvasManager.selectShape(a);
    const spy = jest.spyOn(canvasManager, "duplicateSelection");

    contextMenu.open(0, 0);
    menuEl.querySelector('[data-item-id="duplicate"]').click();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(menuEl.classList.contains("open")).toBe(false);
    teardown();
  });

  test("clicking a disabled item does nothing", () => {
    const { canvasManager, menuEl, contextMenu, teardown } = setupMenu();
    const spy = jest.spyOn(canvasManager, "pasteClipboard");

    contextMenu.open(0, 0); // nothing selected, empty clipboard - paste disabled
    menuEl.querySelector('[data-item-id="paste"]').click();

    expect(spy).not.toHaveBeenCalled();
    expect(menuEl.classList.contains("open")).toBe(true); // stays open
    teardown();
  });

  test("a click outside the menu closes it", async () => {
    const { menuEl, contextMenu, teardown } = setupMenu();
    contextMenu.open(0, 0);
    // The outside-click listener is attached via setTimeout(0) so the
    // opening right-click's own event can't immediately self-close it -
    // see ContextMenu.open's own comment.
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.body.click();

    expect(menuEl.classList.contains("open")).toBe(false);
    teardown();
  });

  test("Escape closes the menu", async () => {
    const { menuEl, contextMenu, teardown } = setupMenu();
    contextMenu.open(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(menuEl.classList.contains("open")).toBe(false);
    teardown();
  });
});

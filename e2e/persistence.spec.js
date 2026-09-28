import { test, expect } from "@playwright/test";
import { blockExternal } from "./helpers.js";

test.describe("save / load persistence", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
  });

  // Regression coverage for docs/TASKS.md P0-2: three overlapping load
  // paths used to run on every page load, reconstructing saved shapes
  // twice.
  test("a saved drawing loads exactly once, not doubled", async ({ page }) => {
    await page.goto("/canvas.html");
    await page.evaluate(() => {
      localStorage.setItem(
        "canvasData",
        JSON.stringify({
          shapes: [
            {
              type: "Circle",
              attrs: {
                x: 100,
                y: 100,
                radius: 25,
                fill: "#fff",
                stroke: "#000",
                strokeWidth: 2,
                name: "Circle 1",
              },
            },
            {
              type: "Rect",
              attrs: {
                x: 200,
                y: 200,
                width: 50,
                height: 50,
                fill: "#fff",
                stroke: "#000",
                strokeWidth: 2,
                name: "Rect 1",
              },
            },
          ],
        })
      );
    });
    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();

    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas restored"
    );
    const shapeCount = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(shapeCount).toBe(2);
    const historyStates = await page.evaluate(
      () => window.historyManager.states.length
    );
    expect(historyStates).toBe(1);
  });

  test("a fresh browser with no saved data shows the empty state", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();

    await expect(page.locator(".save-status-text")).toHaveText(
      "No saved canvas found"
    );
    await expect(page.locator("#addFirstObjectCard")).toBeVisible();
  });

  // Regression coverage for docs/TASKS.md P0-3.
  test("an SVG icon's position and relative iconFile survive a save/reload round-trip, with no absolute URL or DOM leakage in storage", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.evaluate(() => window.svgManager.createSVG("007-excavator.svg"));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!window.canvasManager.shapes.find(
              (s) => s.getClassName() === "Image"
            )
        )
      )
      .toBe(true);

    await page.evaluate(() => {
      const img = window.canvasManager.shapes.find(
        (s) => s.getClassName() === "Image"
      );
      img.position({ x: 321, y: 214 });
    });

    const saved = await page.evaluate(() => {
      const data = JSON.stringify({
        shapes: window.canvasManager.shapes.map((s) =>
          window.canvasManager.toStorageShape(s)
        ),
      });
      localStorage.setItem("canvasData", data);
      return data;
    });
    expect(saved).not.toMatch(/https?:\/\//);
    expect(saved).not.toContain('"image":');
    expect(saved).toContain('"iconFile":"007-excavator.svg"');

    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();
    const afterReload = await page.evaluate(() => {
      const img = window.canvasManager.shapes.find(
        (s) => s.getClassName() === "Image"
      );
      return { x: img?.x(), y: img?.y(), iconFile: img?.getAttr("iconFile") };
    });
    expect(afterReload).toEqual({
      x: 321,
      y: 214,
      iconFile: "007-excavator.svg",
    });
  });

  test("a legacy save (absolute svgUrl, no iconFile) still loads via the basename-fallback migration", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.evaluate(() => {
      localStorage.setItem(
        "canvasData",
        JSON.stringify({
          shapes: [
            {
              type: "Image",
              attrs: {
                x: 50,
                y: 60,
                width: 50,
                height: 50,
                name: "SVG 1",
                svgUrl:
                  "https://old-domain.example.com/assets/svgs/010-building-crane.svg",
              },
            },
          ],
        })
      );
    });
    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    const img = await page.evaluate(() => {
      const i = window.canvasManager.shapes[0];
      return { x: i.x(), y: i.y(), iconFile: i.getAttr("iconFile") };
    });
    expect(img).toEqual({ x: 50, y: 60, iconFile: "010-building-crane.svg" });
  });

  test("hovering an SVG icon does not throw (tooltip methods exist)", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto("/canvas.html");
    await page.evaluate(() =>
      window.svgManager.createSVG("001-manufacture.svg")
    );
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);

    await page.evaluate(() => {
      const img = window.canvasManager.shapes[0];
      img.fire("mouseover", {}, true);
      img.fire("mouseout", {}, true);
    });

    expect(pageErrors).toEqual([]);
  });

  test("Clear Canvas removes the saved document, so a later reload shows the empty state", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");
    await expect
      .poll(() => page.evaluate(() => window.canvasManager.shapes.length))
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("canvasData")))
      .not.toBeNull();

    page.on("dialog", (d) => d.accept());
    await page.click("#clearBtn");
    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas cleared"
    );

    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();
    await expect(page.locator(".save-status-text")).toHaveText(
      "No saved canvas found"
    );
  });
});

// docs/TASKS.md P1-4: core/Persistence.js wired into the real app.
test.describe("Persistence (P1-4): v2 document format, stable identity, IndexedDB fallback", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
  });

  test("a live edit autosaves as a v2 document, and the same document id survives a reload", async ({
    page,
  }) => {
    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");

    await expect
      .poll(() => {
        return page.evaluate(() => {
          const raw = localStorage.getItem("canvasData");
          return raw ? JSON.parse(raw).version : null;
        });
      })
      .toBe(2);

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("canvasData"))
    );
    expect(typeof saved.id).toBe("string");
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved.objects).toHaveLength(1);
    expect(saved.objects[0]).toMatchObject({ type: "Circle", zIndex: 0 });
    expect(typeof saved.objects[0].id).toBe("string");

    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();
    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas restored"
    );

    const afterReload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("canvasData"))
    );
    // Same document identity, not a freshly minted one on every load.
    expect(afterReload.id).toBe(saved.id);
    expect(afterReload.objects[0].id).toBe(saved.objects[0].id);
    const liveShapeId = await page.evaluate(() =>
      window.canvasManager.shapes[0].id()
    );
    expect(liveShapeId).toBe(saved.objects[0].id);
  });

  test("falls back to IndexedDB when localStorage.setItem throws QuotaExceededError, and reload restores from it", async ({
    page,
  }) => {
    // addInitScript runs before any of the page's own scripts, on both
    // the initial load and the reload below, so the monkey-patch stays
    // in effect across the whole test rather than needing to be
    // reapplied after each navigation.
    await page.addInitScript(() => {
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "canvasData") {
          const e = new Error("The quota has been exceeded.");
          e.name = "QuotaExceededError";
          throw e;
        }
        return realSetItem.call(this, key, value);
      };
    });

    await page.goto("/canvas.html");
    await page.click("#shapesTool");
    await page.click("#addCircle");

    await expect(page.locator(".save-status-text")).toHaveText(
      "All changes saved (backup storage)"
    );
    const inLocalStorage = await page.evaluate(() =>
      localStorage.getItem("canvasData")
    );
    expect(inLocalStorage).toBeNull(); // never landed there, by design

    await page.reload();
    await expect(page.locator("#container canvas").first()).toBeVisible();
    await expect(page.locator(".save-status-text")).toHaveText(
      "Canvas restored"
    );
    const shapeCount = await page.evaluate(
      () => window.canvasManager.shapes.length
    );
    expect(shapeCount).toBe(1);
  });
});

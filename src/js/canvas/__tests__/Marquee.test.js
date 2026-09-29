import { normalizeRect, shapesInMarquee } from "../Marquee.js";

describe("normalizeRect", () => {
  test("top-left to bottom-right drag", () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 50, y: 40 })).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 30,
    });
  });

  test("bottom-right to top-left drag (dragged backwards)", () => {
    expect(normalizeRect({ x: 50, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 30,
    });
  });

  test("top-right to bottom-left drag", () => {
    expect(normalizeRect({ x: 50, y: 10 }, { x: 10, y: 40 })).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 30,
    });
  });

  test("zero movement gives a zero-size rect, not NaN/negative", () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("shapesInMarquee", () => {
  const marquee = { x: 0, y: 0, width: 100, height: 100 };

  test("intersect mode (default) selects a shape only partially inside the marquee", () => {
    const partiallyInside = {
      shape: "A",
      box: { x: 80, y: 80, width: 40, height: 40 },
    };
    const fullyInside = {
      shape: "B",
      box: { x: 10, y: 10, width: 10, height: 10 },
    };
    const fullyOutside = {
      shape: "C",
      box: { x: 200, y: 200, width: 10, height: 10 },
    };

    const result = shapesInMarquee(marquee, [
      partiallyInside,
      fullyInside,
      fullyOutside,
    ]);

    expect(result.sort()).toEqual(["A", "B"]);
  });

  test("contain mode excludes a shape that only partially overlaps", () => {
    const partiallyInside = {
      shape: "A",
      box: { x: 80, y: 80, width: 40, height: 40 },
    };
    const fullyInside = {
      shape: "B",
      box: { x: 10, y: 10, width: 10, height: 10 },
    };

    const result = shapesInMarquee(
      marquee,
      [partiallyInside, fullyInside],
      "contain"
    );

    expect(result).toEqual(["B"]);
  });

  test("a shape exactly matching the marquee's own bounds counts as contained", () => {
    const exact = { shape: "A", box: { x: 0, y: 0, width: 100, height: 100 } };
    expect(shapesInMarquee(marquee, [exact], "contain")).toEqual(["A"]);
  });

  test("a shape that merely touches the marquee's edge (zero-area overlap) does not intersect", () => {
    const edgeTouching = {
      shape: "A",
      box: { x: 100, y: 0, width: 20, height: 20 },
    };
    expect(shapesInMarquee(marquee, [edgeTouching])).toEqual([]);
  });

  // A zero-size marquee is really just a point; whether that point
  // falls inside another shape's box is still a well-defined question,
  // even though ToolManager itself never actually calls this with one
  // (it gates on a minimum drag distance before treating anything as a
  // marquee at all - see ToolManager's own MARQUEE_MIN_DRAG).
  test("a zero-size marquee (a single point) still intersects a box that contains that point", () => {
    const point = { x: 10, y: 10, width: 0, height: 0 };
    const surrounding = {
      shape: "A",
      box: { x: 0, y: 0, width: 1000, height: 1000 },
    };
    expect(shapesInMarquee(point, [surrounding])).toEqual(["A"]);
  });

  test("a zero-size marquee outside every box matches nothing", () => {
    const point = { x: -50, y: -50, width: 0, height: 0 };
    const elsewhere = {
      shape: "A",
      box: { x: 0, y: 0, width: 1000, height: 1000 },
    };
    expect(shapesInMarquee(point, [elsewhere])).toEqual([]);
  });
});

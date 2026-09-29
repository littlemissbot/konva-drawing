/**
 * Pure geometry for marquee/rubber-band select (docs/TASKS.md P2-2):
 * turning the two points of a drag into a normalized rectangle, and
 * testing which shapes it touches. Kept separate from ToolManager's own
 * Konva/DOM event wiring for the same reason core/Document.js and
 * canvas/Selection.js are - plain data in, plain data out, so it's
 * unit-testable without a Stage or jsdom's canvas mock.
 */

/** A drag can go in any of the 4 directions from its start point, so
 * the two raw points aren't necessarily already top-left/bottom-right -
 * this turns them into a rect with a non-negative width/height however
 * the drag actually went. */
export function normalizeRect(p1, p2) {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

function intersects(marquee, box) {
  return (
    marquee.x < box.x + box.width &&
    marquee.x + marquee.width > box.x &&
    marquee.y < box.y + box.height &&
    marquee.y + marquee.height > box.y
  );
}

function contains(marquee, box) {
  return (
    box.x >= marquee.x &&
    box.y >= marquee.y &&
    box.x + box.width <= marquee.x + marquee.width &&
    box.y + box.height <= marquee.y + marquee.height
  );
}

/**
 * Which of `entries` (each `{ shape, box }`, `box` a getClientRect()-
 * shaped rect in the same coordinate space as `marqueeRect`) the
 * marquee selects, per `mode`:
 * - "intersect" (the default): anything even partially inside, the
 *   default most drawing tools (Figma included) use for a left-to-right
 *   or ambiguous drag.
 * - "contain": fully enclosed only.
 *
 * There's no UI to switch modes yet (docs/TASKS.md's AC calls for one
 * "per a setting", but this app has no settings surface at all to put
 * it in yet - a real, deliberate scope line, not an oversight); the
 * capability itself is here, parameterized, for whenever one exists.
 *
 * @returns {unknown[]} the matched shapes (whatever type `shape` was on
 *   each entry - this module never touches Konva itself).
 */
export function shapesInMarquee(marqueeRect, entries, mode = "intersect") {
  const test = mode === "contain" ? contains : intersects;
  return entries
    .filter((entry) => test(marqueeRect, entry.box))
    .map((entry) => entry.shape);
}

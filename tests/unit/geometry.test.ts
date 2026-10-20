import { describe, expect, it } from "vitest";
import { insidePolygon, loopsToPath, outline, rect, sampleSegment, type Loop } from "../../src/core/geometry.js";
import { solidify } from "../../src/view/region.js";

/** Signed area in y-down coordinates: positive for clockwise on screen. */
function area(loop: Loop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i]!;
    const [x1, y1] = loop[(i + 1) % loop.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

describe("outline", () => {
  it("traces one rectangle as four corners, clockwise", () => {
    const loops = outline([rect(0, 0, 10, 5)]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(area(loops[0]!)).toBe(50);
  });

  it("merges overlapping and touching rectangles into one loop", () => {
    const loops = outline([rect(0, 0, 10, 10), rect(5, 5, 15, 15), rect(15, 5, 20, 10)]);
    expect(loops).toHaveLength(1);
    expect(area(loops[0]!)).toBe(100 + 100 - 25 + 25);
  });

  it("keeps separate rectangles separate", () => {
    expect(outline([rect(0, 0, 4, 4), rect(10, 0, 14, 4)])).toHaveLength(2);
  });

  it("keeps two areas that touch only at a corner as two loops", () => {
    const loops = outline([rect(0, 0, 10, 10), rect(10, 10, 20, 20)]);
    expect(loops).toHaveLength(2);
    for (const l of loops) expect(area(l)).toBe(100);
  });

  it("gives a hole its own loop, running the other way", () => {
    const ring = [rect(0, 0, 30, 10), rect(0, 20, 30, 30), rect(0, 10, 10, 20), rect(20, 10, 30, 20)];
    const loops = outline(ring);
    expect(loops).toHaveLength(2);
    const areas = loops.map(area).sort((a, b) => a - b);
    expect(areas).toEqual([-100, 900]);
  });

  it("traces a staircase of text lines as one loop", () => {
    const lines = [rect(50, 0, 100, 10), rect(0, 10, 100, 20), rect(0, 20, 40, 30)];
    const loops = outline(lines);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(8);
  });

  it("ignores empty rectangles", () => {
    expect(outline([rect(0, 0, 0, 10), rect(5, 5, 5, 5)])).toEqual([]);
  });

  it("writes closed SVG paths", () => {
    expect(loopsToPath(outline([rect(0, 0, 2, 1)]))).toMatch(/^M0 0L2 0L2 1L0 1Z$/);
  });
});

describe("solidify", () => {
  it("grows glyph boxes to the line height and closes the gaps between lines", () => {
    const glyphs = [rect(10, 4, 200, 20), rect(0, 30, 200, 46), rect(0, 56, 80, 72)];
    const bands = solidify(glyphs, 26);
    const loops = outline(bands);
    expect(loops).toHaveLength(1);
    expect(bands[0]!.y0).toBe(-1);
    expect(bands[bands.length - 1]!.y1).toBe(77);
  });

  it("joins pieces on one line that sit close together", () => {
    const bands = solidify([rect(0, 0, 40, 16), rect(44, 0, 90, 16)], 16);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ x0: 0, x1: 90 });
  });

  it("keeps far-apart pieces on one line apart", () => {
    expect(solidify([rect(0, 0, 40, 16), rect(200, 0, 240, 16)], 16)).toHaveLength(2);
  });
});

describe("hit helpers", () => {
  it("tests points against a polygon", () => {
    const tri = [[0, 0], [10, 0], [0, 10]] as const;
    expect(insidePolygon([2, 2], tri)).toBe(true);
    expect(insidePolygon([8, 8], tri)).toBe(false);
  });
  it("samples a segment with both ends", () => {
    const pts = sampleSegment([0, 0], [10, 0], 4);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([10, 0]);
    expect(pts.length).toBe(4);
  });
});

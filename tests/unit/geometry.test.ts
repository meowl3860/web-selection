import { describe, expect, it } from "vitest";
import { segmentBounds, strokeTouchesRect, type Rect } from "../../src/geometry.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

describe("strokeTouchesRect", () => {
  const box = rect(100, 100, 200, 150);

  it("is true for a dab inside the box", () => {
    expect(strokeTouchesRect([150, 120], [150, 120], 5, box)).toBe(true);
  });

  it("is true when only the round edge of a dab reaches the box", () => {
    expect(strokeTouchesRect([95, 120], [95, 120], 6, box)).toBe(true);
    expect(strokeTouchesRect([95, 120], [95, 120], 4, box)).toBe(false);
  });

  it("is true for a stroke that runs right through the box", () => {
    expect(strokeTouchesRect([50, 125], [250, 125], 2, box)).toBe(true);
  });

  it("is true when the side of a stroke grazes a corner", () => {
    expect(strokeTouchesRect([180, 170], [230, 120], 8, box)).toBe(true);
    expect(strokeTouchesRect([190, 190], [250, 130], 8, box)).toBe(false);
  });

  it("is false for a stroke that passes by", () => {
    expect(strokeTouchesRect([50, 200], [250, 200], 10, box)).toBe(false);
  });

  it("bounds a stroke with its radius", () => {
    expect(segmentBounds([10, 20], [30, 5], 4)).toEqual(rect(6, 1, 34, 24));
  });
});

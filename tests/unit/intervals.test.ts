import { describe, expect, it } from "vitest";
import { combine, covers, equals, intersect, normalize, size, subtract, union } from "../../src/core/intervals.js";

describe("normalize", () => {
  it("sorts, merges overlapping and touching runs, and drops empty ones", () => {
    expect(normalize([[8, 10], [0, 3], [3, 5], [4, 6], [12, 12]])).toEqual([[0, 6], [8, 10]]);
  });
  it("keeps runs with a gap apart", () => {
    expect(normalize([[0, 2], [3, 4]])).toEqual([[0, 2], [3, 4]]);
  });
});

describe("set operations", () => {
  const a = [[0, 10], [20, 30]] as const;
  const b = [[5, 25]] as const;

  it("union", () => {
    expect(union(a, b)).toEqual([[0, 30]]);
    expect(union([], b)).toBe(b);
  });

  it("subtract", () => {
    expect(subtract(a, b)).toEqual([[0, 5], [25, 30]]);
    expect(subtract(b, a)).toEqual([[10, 20]]);
    expect(subtract(a, [])).toBe(a);
    expect(subtract([[0, 10]], [[2, 3], [5, 6], [9, 12]])).toEqual([[0, 2], [3, 5], [6, 9]]);
  });

  it("subtract with one cut spanning several runs", () => {
    expect(subtract([[0, 2], [4, 6], [8, 10]], [[1, 9]])).toEqual([[0, 1], [9, 10]]);
  });

  it("intersect", () => {
    expect(intersect(a, b)).toEqual([[5, 10], [20, 25]]);
    expect(intersect(a, [])).toEqual([]);
  });

  it("size, equals and covers", () => {
    expect(size(a)).toBe(20);
    expect(equals(a, [[0, 10], [20, 30]])).toBe(true);
    expect(equals(a, b)).toBe(false);
    expect(covers(a, [[2, 4], [21, 22]])).toBe(true);
    expect(covers(a, [[9, 21]])).toBe(false);
  });
});

describe("combine follows Photoshop's four modes", () => {
  const cur = [[0, 10]] as const;
  const region = [[5, 15]] as const;
  it("new replaces", () => expect(combine(cur, region, "new")).toEqual(region));
  it("add unites", () => expect(combine(cur, region, "add")).toEqual([[0, 15]]));
  it("subtract cuts", () => expect(combine(cur, region, "subtract")).toEqual([[0, 5]]));
  it("intersect keeps the overlap", () => expect(combine(cur, region, "intersect")).toEqual([[5, 10]]));
});

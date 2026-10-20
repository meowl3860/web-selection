import { describe, expect, it } from "vitest";
import { colorDistance, distance, parseColor, signature, type Features } from "../../src/core/features.js";
import { countWords } from "../../src/core/snapshot.js";

const body: Features = {
  kind: "paragraph", tag: "p", level: 0, fontSize: 16, fontWeight: 400, family: "segoe ui", italic: false, mono: false,
  color: [29, 32, 48, 1], background: [255, 255, 255, 1], left: 416, width: 720, lineHeight: 26, pre: false,
  list: 0, depth: 0, table: 0, column: 0, media: "", area: 0,
};
const f = (patch: Partial<Features>): Features => ({ ...body, ...patch });

describe("distance", () => {
  it("is zero for the same look", () => {
    expect(distance(body, f({ width: 300 }))).toBe(0);
  });

  it("keeps paragraphs and headings far apart", () => {
    const h2 = f({ kind: "heading", tag: "h2", level: 2, fontSize: 26, fontWeight: 700 });
    expect(distance(body, h2)).toBeGreaterThan(60);
  });

  it("puts list items past the default tolerance but within reach", () => {
    const li = f({ kind: "list-item", tag: "li", left: 442, list: 1, depth: 1 });
    const d = distance(body, li);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(40);
  });

  it("treats a code block as a different kind", () => {
    const code = f({ kind: "code", tag: "pre", family: "cascadia mono", mono: true, fontSize: 13.5, pre: true });
    expect(distance(body, code)).toBeGreaterThan(50);
  });

  it("never matches text to a picture below full tolerance", () => {
    expect(distance(body, f({ kind: "media", tag: "img", media: "img", area: 50000 }))).toBeGreaterThanOrEqual(100);
  });

  it("tells table columns apart", () => {
    const c0 = f({ kind: "cell", tag: "td", table: 1, column: 0 });
    const c1 = f({ kind: "cell", tag: "td", table: 1, column: 1, left: 760 });
    expect(distance(c0, f({ kind: "cell", tag: "td", table: 1, column: 0, left: 416 }))).toBe(0);
    expect(distance(c0, c1)).toBeGreaterThan(12);
  });

  it("treats a faintly tinted callout box as an edge", () => {
    const note = f({ background: [242, 246, 255, 1], left: 438 });
    expect(distance(body, note)).toBeGreaterThan(20);
    expect(distance(body, f({ background: [254, 254, 254, 1] }))).toBeLessThan(2);
  });

  it("is symmetric", () => {
    const li = f({ kind: "list-item", tag: "li", left: 442, list: 1, depth: 1, color: [80, 90, 200, 1] });
    expect(distance(body, li)).toBeCloseTo(distance(li, body), 6);
  });
});

describe("signature", () => {
  it("groups blocks that look the same", () => {
    expect(signature(body)).toBe(signature(f({ width: 10 })));
    expect(signature(body)).not.toBe(signature(f({ fontSize: 18 })));
  });
});

describe("colours", () => {
  it("parses rgb and rgba", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3, 0.5]);
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5]);
  });
  it("measures black against white as 1", () => {
    expect(colorDistance([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(1, 2);
    expect(colorDistance([10, 10, 10, 1], [10, 10, 10, 1])).toBe(0);
  });
});

describe("countWords", () => {
  it("counts spaced words", () => expect(countWords("Frame time, not frame rate.")).toBe(5));
  it("counts each Japanese character", () => expect(countWords("16.7ミリ秒です")).toBe(2 + 5));
  it("keeps contractions and hyphens in one word", () => expect(countWords("don't G-buffer")).toBe(2));
});

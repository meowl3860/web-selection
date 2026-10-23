import { describe, expect, it } from "vitest";
import type { PaintArea } from "../../src/brush.js";
import { boxText, cropBox, fitBox, fitSize } from "../../src/context/picture.js";
import { marked, paintedRuns, partlyPainted, shorten, type Char } from "../../src/context/text.js";
import { estimateTokens, imageTokens } from "../../src/context/tokens.js";

/** Characters from a string where [brackets] mark the painted part. */
function chars(s: string): Char[] {
  const out: Char[] = [];
  let painted = false;
  for (const ch of s) {
    if (ch === "[") painted = true;
    else if (ch === "]") painted = false;
    else out.push({ ch, painted });
  }
  return out;
}

const area = (box: PaintArea["box"], width = 200, height = 100): PaintArea => ({ width, height, box, coverage: 0.1, strokes: [] });

describe("tokens", () => {
  it("counts about 2.8 characters a token, and one for each Japanese character", () => {
    expect(estimateTokens("a".repeat(280))).toBe(100);
    expect(estimateTokens("フレームタイム")).toBe(7);
  });

  it("counts a picture by its pixels", () => {
    expect(imageTokens(750, 100)).toBe(100);
  });
});

describe("marks", () => {
  it("wraps each painted run, and keeps spaces outside the marks", () => {
    expect(marked(chars("it costs [6.7 ms ]now"), "<mark>", "</mark>")).toBe("it costs <mark>6.7 ms</mark> now");
  });

  it("never wraps a line break", () => {
    expect(marked(chars("a [b\nc] d"), "<", ">")).toBe("a <b>\n<c> d");
  });

  it("lists only the painted runs", () => {
    expect(paintedRuns(chars("one [two] three [four five] six"))).toEqual(["two", "four five"]);
  });

  it("calls text partly painted only when some but not nearly all of it is", () => {
    expect(partlyPainted(chars("[all of it]"))).toBe(false);
    expect(partlyPainted(chars("none of it"))).toBe(false);
    expect(partlyPainted(chars("some [of] it"))).toBe(true);
  });

  it("shortens the unpainted text around painted runs", () => {
    const text = shorten(chars("a long start before [the word] and a long end after"), 4);
    expect(text.map((c) => c.ch).join("")).toBe(" … the word and …");
  });
});

describe("pictures", () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };

  it("places a picture the way object-fit does", () => {
    expect(fitBox("fill", "50% 50%", box, 400, 400)).toEqual(box);
    expect(fitBox("contain", "50% 50%", box, 400, 400)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(fitBox("cover", "50% 50%", box, 400, 400)).toEqual({ x: 0, y: -50, w: 200, h: 200 });
    expect(fitBox("cover", "0% 0%", box, 400, 400)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(fitBox("none", "50% 50%", box, 40, 20)).toEqual({ x: 80, y: 40, w: 40, h: 20 });
  });

  it("scales a picture down to the longest side and the most pixels", () => {
    expect(fitSize(3000, 1500, 1568)).toEqual({ width: 1517, height: 758 });
    expect(fitSize(400, 300, 1568)).toEqual({ width: 400, height: 300 });
  });

  it("gives the painted box as a share of the visible picture", () => {
    expect(boxText(area({ x0: 0.25, y0: 0.1, x1: 0.5, y1: 0.6 }), box)).toBe("x 25–50%, y 10–60% (from the top left)");
    // The picture shows only in the middle half of its element.
    expect(boxText(area({ x0: 0.25, y0: 0, x1: 0.5, y1: 1 }), { x: 50, y: 0, w: 100, h: 100 })).toBe("x 0–50%, y 0–100% (from the top left)");
    expect(boxText(area(null), box)).toBeNull();
  });

  it("crops the painted part with room around it, inside the picture", () => {
    expect(cropBox(area({ x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.6 }), box)).toEqual({ x: 58, y: 18, w: 64, h: 64 });
    expect(cropBox(area({ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }), box)).toEqual({ x: 0, y: 0, w: 42, h: 37 });
  });
});

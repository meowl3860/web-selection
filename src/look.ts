// How a selected element looks: its letters jitter, and a picture is pinned like a photo. The page must not move, so nothing here changes size. For jittering text the page's
// own letters only lose their fill; the brush draws them again, moving (see jitter.ts). A pinned
// element gets a white edge, a soft shadow and a small tilt, which never changes the layout. A
// picture inside a box that clips it closely, such as a rounded card, is framed instead: the
// white edge is drawn inside it and it does not tilt, since the box would cut off both.
// Everything is plain CSS in one style sheet, keyed by attributes on the selected elements;
// taking the attributes away puts the page back.

export const LOOK_ATTR = "data-ws-look";
const ID_ATTR = "data-ws-n";

const BASE = `
[${LOOK_ATTR}="jitter"], [${LOOK_ATTR}="jitter"] * {
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
}
[${LOOK_ATTR}="pinned"] {
  outline: 5px solid #ffffff !important;
  outline-offset: 0 !important;
  box-shadow: 0 6px 18px rgba(15, 18, 35, 0.3) !important;
}
[${LOOK_ATTR}="framed"] {
  outline: 5px solid #ffffff !important;
  outline-offset: -5px !important;
}
`;

export type LookKind = "jitter" | "pinned" | "framed";

interface Look {
  n: number;
  kind: LookKind;
  /** A pinned element's tilt in degrees: smaller for wider things, so their edges stay calm. */
  tilt: number;
}

export class Looks {
  private next = 1;
  private readonly looks = new Map<Element, Look>();
  private readonly sheets = new Map<Node, HTMLStyleElement>();

  constructor(private readonly doc: Document) {}

  get size(): number {
    return this.looks.size;
  }

  /** Makes exactly these elements carry the look. */
  set(wanted: Map<Element, LookKind>): void {
    for (const [el, look] of [...this.looks]) if (wanted.get(el) !== look.kind) this.drop(el);
    for (const [el, kind] of wanted) {
      if (this.looks.has(el)) continue;
      const tilt = kind === "pinned" ? tiltFor(el.getBoundingClientRect().width) : 0;
      const look = { n: this.next++, kind, tilt };
      this.looks.set(el, look);
      el.setAttribute(ID_ATTR, String(look.n));
      el.setAttribute(LOOK_ATTR, kind);
    }
    this.writeSheets();
  }

  /** Works out the tilts again after the page changed size, since wider things tilt less. */
  refit(): void {
    for (const [el, look] of this.looks) {
      if (look.kind !== "pinned") continue;
      el.removeAttribute(LOOK_ATTR);
      look.tilt = tiltFor(el.getBoundingClientRect().width);
      el.setAttribute(LOOK_ATTR, look.kind);
    }
    this.writeSheets();
  }

  /** Puts the attributes back on elements that a page framework drew again without them. */
  restore(): void {
    for (const [el, look] of this.looks) {
      if (el.getAttribute(LOOK_ATTR) !== look.kind) el.setAttribute(LOOK_ATTR, look.kind);
      if (el.getAttribute(ID_ATTR) !== String(look.n)) el.setAttribute(ID_ATTR, String(look.n));
    }
  }

  clear(): void {
    for (const el of [...this.looks.keys()]) this.drop(el);
    this.writeSheets();
  }

  /** The tilt of a pinned element in degrees, clockwise; 0 when it is not pinned. */
  tiltOf(el: Element): number {
    const look = this.looks.get(el);
    return look?.kind === "pinned" ? look.tilt : 0;
  }

  /**
   * Runs `fn` with the pinned elements untilted, to measure them as laid out. The tilt never
   * changes the layout, and nothing is drawn in between, so nothing on the screen moves.
   */
  unpinned<T>(fn: () => T): T {
    const pinned = [...this.looks].filter(([, look]) => look.kind === "pinned").map(([el]) => el);
    for (const el of pinned) el.removeAttribute(LOOK_ATTR);
    try {
      return fn();
    } finally {
      for (const el of pinned) el.setAttribute(LOOK_ATTR, "pinned");
    }
  }

  /** Takes every look off for a moment; the returned function puts them back. */
  suspend(): () => void {
    const on = [...this.looks];
    for (const [el] of on) el.removeAttribute(LOOK_ATTR);
    return () => {
      for (const [el, look] of on) if (this.looks.get(el) === look) el.setAttribute(LOOK_ATTR, look.kind);
    };
  }

  private drop(el: Element): void {
    el.removeAttribute(LOOK_ATTR);
    el.removeAttribute(ID_ATTR);
    this.looks.delete(el);
  }

  /** One style sheet in each place that holds a selected element: the page, or a shadow root. */
  private writeSheets(): void {
    let rules = BASE;
    const homes = new Set<Node>();
    for (const [el, look] of this.looks) {
      homes.add(homeOf(el));
      if (look.kind === "pinned") rules += `[${ID_ATTR}="${look.n}"] { rotate: ${look.tilt.toFixed(2)}deg !important; }\n`;
    }
    for (const home of homes) {
      let st = this.sheets.get(home);
      if (!st) {
        st = this.doc.createElement("style");
        st.setAttribute("data-web-selection", "");
        home.appendChild(st);
        this.sheets.set(home, st);
      }
      if (st.textContent !== rules) st.textContent = rules;
    }
    for (const [home, st] of [...this.sheets]) {
      if (homes.has(home)) continue;
      st.remove();
      this.sheets.delete(home);
    }
  }
}

/** Wider things tilt less, so their edges stay calm. */
function tiltFor(width: number): number {
  return -Math.max(0.4, Math.min(1.4, 420 / Math.max(1, width)));
}

/** Where the style sheet goes for an element: the page head, or its shadow root. */
function homeOf(el: Element): Node {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) return root;
  return el.ownerDocument.head ?? el.ownerDocument.documentElement;
}

/** Code keeps its own font: its columns line up only in a font where every letter is as wide. */
export function isCode(el: Element): boolean {
  if (el.localName === "pre") return true;
  return /mono|consol|courier|menlo|monaco|code/i.test(getComputedStyle(el).fontFamily);
}

/** True when an element paints a box of its own: a background, a shadow, or borders around it. */
export function paintsBox(el: Element): boolean {
  const cs = getComputedStyle(el);
  const bg = /rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,/]+([\d.]+%?))?/.exec(cs.backgroundColor);
  const alpha = bg ? (bg[1] === undefined ? 1 : bg[1].endsWith("%") ? parseFloat(bg[1]) / 100 : parseFloat(bg[1])) : 0;
  if (alpha > 0.05 || cs.backgroundImage !== "none" || cs.boxShadow !== "none") return true;
  let sides = 0;
  for (const s of ["top", "right", "bottom", "left"]) {
    if (parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 && !/none|hidden/.test(cs.getPropertyValue(`border-${s}-style`))) sides++;
  }
  return sides >= 3;
}

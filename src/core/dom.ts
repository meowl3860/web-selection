// The flat tree: the tree the browser lays out, with shadow roots and slots in place. Pages
// built from web components keep text inside shadow roots, and slots move light children into
// them, so walking `parentElement` alone gives the wrong boxes and the wrong order.

/** Returns the shadow root to walk for an element, or null. Extensions can also open closed ones. */
export type ShadowOf = (el: Element) => ShadowRoot | null;

export const openShadow: ShadowOf = (el) => el.shadowRoot;

/** The parent in the flat tree: the slot a node is shown in, or the host of a shadow root. */
export function flatParent(n: Node): Element | null {
  const slot = (n as Element | Text).assignedSlot;
  if (slot) return slot;
  const p = n.parentNode;
  if (!p) return null;
  if (p.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return (p as ShadowRoot).host ?? null;
  return p.nodeType === Node.ELEMENT_NODE ? (p as Element) : null;
}

/** True when `inner` is `outer` or sits inside it in the flat tree. */
export function flatContains(outer: Element, inner: Node): boolean {
  for (let n: Node | null = inner; n; n = flatParent(n)) if (n === outer) return true;
  return false;
}

/** The deepest element under a viewport point, looking inside open shadow roots. */
export function deepElementAt(doc: Document, x: number, y: number, ignore: (el: Element) => boolean, shadowOf: ShadowOf = openShadow): Element | null {
  let el = doc.elementsFromPoint(x, y).find((e) => !ignore(e)) ?? null;
  for (let guard = 0; el && guard < 32; guard++) {
    const root = shadowOf(el);
    if (!root) break;
    const inner: Element | undefined = root.elementsFromPoint(x, y).find((e) => e.getRootNode() === root && !ignore(e));
    if (!inner) break;
    el = inner;
  }
  return el;
}

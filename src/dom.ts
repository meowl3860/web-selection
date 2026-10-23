// The flat tree: the tree the browser lays out, with shadow roots and slots in place. Pages
// built from web components keep their text inside shadow roots, so walking `parentElement`
// alone misses it.

/** Returns the shadow root to walk for an element, or null. An extension can open closed ones. */
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

/** The deepest element under a viewport point, looking inside shadow roots. */
export function deepElementAt(doc: Document, x: number, y: number, ignore: (el: Element) => boolean, shadowOf: ShadowOf): Element | null {
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

import {
  findPlaceholder,
  firstByTag,
  listStyleEntry,
  mapSlidePackage,
  placeholderOf,
  type SlideDocument,
} from './pptxXml'

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** The paragraph's own `<a:pPr>` child, if the paragraph carries one. */
function paragraphProps(para: Element): Element | null {
  for (const child of Array.from(para.children)) {
    if (child.localName === 'pPr') return child
  }
  return null
}

/**
 * Effective paragraph alignment resolved the way PowerPoint does it: the
 * paragraph's own pPr, then the shape's list style for the paragraph's level,
 * then the same placeholder up the layout/master chain. Returns null when
 * nothing in the chain states an alignment, so callers leave the paragraph
 * untouched rather than guessing a default.
 */
function resolveAlgn(shape: Element, para: Element, ancestors: (Document | null)[]): string | null {
  const pPr = paragraphProps(para)
  if (pPr?.getAttribute('algn')) return null
  const level = Number(pPr?.getAttribute('lvl') ?? 0) + 1
  const txBody = firstByTag(shape, 'p:txBody')

  const own = listStyleEntry(txBody, level)?.getAttribute('algn')
  if (own) return own

  const ph = placeholderOf(shape)
  if (!ph) return null
  for (const doc of ancestors) {
    const inherited = findPlaceholder(doc, ph)
    if (!inherited) continue
    const algn = listStyleEntry(firstByTag(inherited, 'p:txBody'), level)?.getAttribute('algn')
    if (algn) return algn
  }
  return null
}

function applyAlgn(doc: Document, para: Element, value: string): void {
  const pPr = paragraphProps(para)
  if (pPr) {
    pPr.setAttribute('algn', value)
    return
  }
  const created = doc.createElementNS(DRAWINGML_NS, 'a:pPr')
  created.setAttribute('algn', value)
  para.insertBefore(created, para.firstChild)
}

function patchDocument({ doc, ancestors }: SlideDocument): number {
  let patched = 0
  for (const shape of Array.from(doc.getElementsByTagName('p:sp'))) {
    const txBody = firstByTag(shape, 'p:txBody')
    if (!txBody) continue
    for (const para of Array.from(txBody.getElementsByTagName('a:p'))) {
      const algn = resolveAlgn(shape, para, ancestors)
      if (!algn) continue
      applyAlgn(doc, para, algn)
      patched += 1
    }
  }
  return patched
}

/**
 * pptx-preview paints paragraph alignment only when the paragraph itself carries
 * an explicit `<a:pPr algn>`. Alignment inherited from a shape's list style or
 * from the layout/master placeholder — which is how PowerPoint stores "centred"
 * — is dropped, so centred template text (the cover lab name, for example)
 * renders left. This materializes the inherited value into each paragraph so the
 * library paints what PowerPoint shows.
 */
export function patchPptxTextAlignment(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  return mapSlidePackage(buffer, patchDocument)
}

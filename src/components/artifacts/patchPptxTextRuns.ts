import {
  findPlaceholder,
  firstByTag,
  listStyleEntry,
  mapSlidePackage,
  placeholderOf,
  type SlideDocument,
} from './pptxXml'

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** Run properties copied as attributes (sz = hundredths of a point, b/i = booleans). */
const COPIED_ATTRS = ['sz', 'b', 'i'] as const

/** rPr children that must stay after the fill element, per the DrawingML schema. */
const AFTER_FILL = new Set([
  'effectLst', 'effectDag', 'highlight', 'uLnTx', 'uLn', 'uFillTx', 'uFill',
  'latin', 'ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst',
])

function childByLocalName(parent: Element, name: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.localName === name) return child
  }
  return null
}

/** `<a:lvl{N}pPr><a:defRPr>` for the paragraph's level, from a text body. */
function levelRunProps(txBody: Element | null, level: number): Element | null {
  const entry = listStyleEntry(txBody, level)
  return entry ? childByLocalName(entry, 'defRPr') : null
}

/**
 * Run formatting resolved the way PowerPoint does it: the shape's own list style
 * for the paragraph's level, then the layout/master placeholder with the same
 * (type, idx). pptx-preview resolves placeholder runs by `type` alone, so every
 * body placeholder in a layout inherits the *first* body placeholder's colour
 * and size — the deck's date, name and e-mail all come out in the date's orange.
 */
function resolveRunProps(shape: Element, level: number, ancestors: (Document | null)[]): Element | null {
  const txBody = firstByTag(shape, 'p:txBody')
  const own = levelRunProps(txBody, level)
  if (own) return own

  const ph = placeholderOf(shape)
  if (!ph) return null
  for (const doc of ancestors) {
    const inherited = findPlaceholder(doc, ph)
    if (!inherited) continue
    const props = levelRunProps(firstByTag(inherited, 'p:txBody'), level)
    if (props) return props
  }
  return null
}

function insertFill(rPr: Element, fill: Element): void {
  let anchor: Element | null = null
  for (const child of Array.from(rPr.children)) {
    if (AFTER_FILL.has(child.localName)) {
      anchor = child
      break
    }
  }
  rPr.insertBefore(fill, anchor)
}

/** Copies the inherited properties a run does not state itself; returns how many it wrote. */
function applyRunProps(owner: Document, run: Element, props: Element): number {
  const runProps = childByLocalName(run, 'rPr')
  const hasAttr = COPIED_ATTRS.filter((name) => props.hasAttribute(name) && !runProps?.hasAttribute(name))
  const inheritedFill = childByLocalName(props, 'solidFill')
  const needsFill =
    inheritedFill !== null &&
    (!runProps || (childByLocalName(runProps, 'solidFill') === null && childByLocalName(runProps, 'noFill') === null))
  if (hasAttr.length === 0 && !needsFill) return 0

  const target = runProps ?? owner.createElementNS(DRAWINGML_NS, 'a:rPr')
  if (!runProps) run.insertBefore(target, run.firstChild)
  for (const name of hasAttr) {
    target.setAttribute(name, props.getAttribute(name) ?? '')
  }
  if (needsFill && inheritedFill) {
    insertFill(target, inheritedFill.cloneNode(true) as Element)
  }
  return 1
}

function patchDocument({ doc, ancestors }: SlideDocument): number {
  let patched = 0
  for (const shape of Array.from(doc.getElementsByTagName('p:sp'))) {
    const txBody = firstByTag(shape, 'p:txBody')
    if (!txBody) continue
    for (const para of Array.from(txBody.getElementsByTagName('a:p'))) {
      const pPr = ((): Element | null => {
        for (const child of Array.from(para.children)) {
          if (child.localName === 'pPr') return child
        }
        return null
      })()
      const level = Number(pPr?.getAttribute('lvl') ?? 0) + 1
      const props = resolveRunProps(shape, level, ancestors)
      if (!props) continue
      for (const run of Array.from(para.children)) {
        if (run.localName !== 'r') continue
        patched += applyRunProps(doc, run, props)
      }
    }
  }
  return patched
}

/**
 * pptx-preview resolves placeholder run formatting by placeholder *type*, so a
 * layout whose body placeholders differ per index (date orange, name white,
 * contact smaller) paints them all with the first one's colour and size. This
 * writes the formatting each placeholder actually inherits onto its own runs.
 */
export function patchPptxTextRuns(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  return mapSlidePackage(buffer, patchDocument)
}

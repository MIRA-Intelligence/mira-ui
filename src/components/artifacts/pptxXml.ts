import JSZip from 'jszip'

const XML_DECL = /^\s*<\?xml[^>]*\?>/
const SLIDE_XML = /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/

export interface Placeholder {
  type: string
  idx: number
}

export interface SlideDocument {
  path: string
  doc: Document
  /** Layout then master (for slides), master (for layouts), empty for masters. */
  ancestors: (Document | null)[]
}

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc
  } catch {
    return null
  }
}

export function firstByTag(parent: Element | Document, tag: string): Element | null {
  const list = parent.getElementsByTagName(tag)
  return list.length > 0 ? list[0] : null
}

/** Placeholder identity of a shape, or null when it is not a placeholder. */
export function placeholderOf(shape: Element): Placeholder | null {
  const ph = firstByTag(shape, 'p:ph')
  if (!ph) return null
  const type = ph.getAttribute('type') || 'body'
  const raw = Number(ph.getAttribute('idx'))
  return { type, idx: Number.isFinite(raw) ? raw : 0 }
}

/**
 * The list-style entry for a 1-based level. pptx-preview matches placeholders by
 * `type` alone and drops everything nested in list styles, so callers resolve
 * what PowerPoint would inherit and write it onto the shape's own paragraphs and
 * runs instead.
 */
export function listStyleEntry(txBody: Element | null, level: number): Element | null {
  const lstStyle = txBody ? firstByTag(txBody, 'a:lstStyle') : null
  return lstStyle ? firstByTag(lstStyle, `a:lvl${level}pPr`) : null
}

export function findPlaceholder(doc: Document | null, target: Placeholder): Element | null {
  if (!doc) return null
  for (const shape of Array.from(doc.getElementsByTagName('p:sp'))) {
    const ph = placeholderOf(shape)
    if (ph && ph.type === target.type && ph.idx === target.idx) return shape
  }
  return null
}

/** Resolve a relationship target relative to the folder holding its rels file. */
function resolveRelTarget(relsPath: string, target: string): string {
  const base = relsPath.replace(/_rels\/[^/]+$/, '')
  const stack: string[] = []
  for (const segment of (base + target).split('/')) {
    if (segment === '..') stack.pop()
    else if (segment !== '.' && segment !== '') stack.push(segment)
  }
  return stack.join('/')
}

function relationshipTarget(relsXml: string, typeSuffix: string): string | null {
  const match = new RegExp(`<Relationship[^>]*Type="[^"]*${typeSuffix}"[^>]*Target="([^"]+)"`).exec(relsXml)
  return match ? match[1] : null
}

function relsPathFor(xmlPath: string): string {
  const [folder, name] = [xmlPath.split('/')[1], xmlPath.split('/').pop()]
  return `ppt/${folder}/_rels/${name}.rels`
}

/**
 * Loads a pptx, hands every slide/layout/master document (with its inheritance
 * ancestors) to `transform`, and repacks only the parts it changed. Returns the
 * original buffer when nothing changed or when the input is not a readable zip,
 * so callers can chain patches without copying bytes needlessly.
 */
export async function mapSlidePackage(
  buffer: ArrayBuffer,
  transform: (target: SlideDocument) => number,
): Promise<ArrayBuffer> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return buffer
  }

  const targets = Object.keys(zip.files).filter((path) => SLIDE_XML.test(path) && !zip.files[path].dir)
  if (targets.length === 0) return buffer

  const docs = new Map<string, Document | null>()
  const rawTexts = new Map<string, string>()
  const readDoc = async (path: string): Promise<Document | null> => {
    if (docs.has(path)) return docs.get(path) ?? null
    const file = zip.files[path]
    const text = file && !file.dir ? await file.async('string') : ''
    rawTexts.set(path, text)
    const doc = text ? parseXml(text) : null
    docs.set(path, doc)
    return doc
  }

  const relsCache = new Map<string, string | null>()
  const readRels = async (xmlPath: string): Promise<string | null> => {
    const relsPath = relsPathFor(xmlPath)
    if (relsCache.has(relsPath)) return relsCache.get(relsPath) ?? null
    const file = zip.files[relsPath]
    const text = file && !file.dir ? await file.async('string') : null
    relsCache.set(relsPath, text)
    return text
  }

  const relatedDoc = async (xmlPath: string, type: string): Promise<Document | null> => {
    const rels = await readRels(xmlPath)
    const target = rels ? relationshipTarget(rels, type) : null
    if (!target) return null
    return readDoc(resolveRelTarget(relsPathFor(xmlPath), target))
  }

  const ancestorsOf = async (path: string): Promise<(Document | null)[]> => {
    if (path.startsWith('ppt/slideMasters/')) return []
    if (path.startsWith('ppt/slideLayouts/')) return [await relatedDoc(path, 'slideMaster')]
    const layout = await relatedDoc(path, 'slideLayout')
    const rels = await readRels(path)
    const layoutTarget = rels ? relationshipTarget(rels, 'slideLayout') : null
    if (!layoutTarget) return [null, null]
    const layoutPath = resolveRelTarget(relsPathFor(path), layoutTarget)
    return [layout, await relatedDoc(layoutPath, 'slideMaster')]
  }

  let changed = false
  for (const path of targets) {
    const doc = await readDoc(path)
    if (!doc) continue
    if (transform({ path, doc, ancestors: await ancestorsOf(path) }) === 0) continue
    const declaration = XML_DECL.exec(rawTexts.get(path) ?? '')
    const serialized = new XMLSerializer().serializeToString(doc)
    zip.file(path, declaration ? `${declaration[0]}${serialized}` : serialized)
    changed = true
  }

  if (!changed) return buffer
  return zip.generateAsync({ type: 'arraybuffer' })
}

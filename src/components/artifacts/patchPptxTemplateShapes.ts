import JSZip from 'jszip'

const TEMPLATE_XML = /^ppt\/(slideLayouts|slideMasters)\/[^/]+\.xml$/

// Shapes pptx-preview filters out unless `<p:nvPr>` carries the WPS-specific
// `userDrawn="1"` marker. Pictures, groups, tables and charts are exempt: the
// library hardcodes userDrawn for those node types, so only plain shapes and
// connectors need the attribute.
const SHAPE = /<p:(sp|cxnSp)(?:\s[^>]*)?>[\s\S]*?<\/p:\1>/g

// Placeholder shapes are left alone: pptx-preview does not implement
// placeholder inheritance, so a marked placeholder would paint its template
// prompt text ("点击编辑论文标题") onto every slide that uses the layout.
function patchXml(xml: string): string {
  return xml.replace(SHAPE, (shape) => {
    if (/userDrawn/.test(shape)) return shape
    if (/<p:ph[\s/>]/.test(shape)) return shape
    return shape.replace(/<p:nvPr/g, '<p:nvPr userDrawn="1"')
  })
}

/**
 * pptx-preview renders master/layout shapes only when `p:nvPr` carries the
 * WPS-specific `userDrawn="1"` marker. Decks written by PowerPoint mark only
 * some of their template shapes — the pictures, say, but none of the boxes
 * around them — so the rest silently disappears. This adds the marker to every
 * non-placeholder shape that still lacks it.
 */
export async function patchPptxTemplateShapes(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return buffer
  }
  let changed = false
  for (const path of Object.keys(zip.files)) {
    if (!TEMPLATE_XML.test(path)) continue
    const file = zip.files[path]
    if (file.dir) continue
    const xml = await file.async('string')
    const patched = patchXml(xml)
    if (patched !== xml) {
      zip.file(path, patched)
      changed = true
    }
  }
  if (!changed) return buffer
  return zip.generateAsync({ type: 'arraybuffer' })
}

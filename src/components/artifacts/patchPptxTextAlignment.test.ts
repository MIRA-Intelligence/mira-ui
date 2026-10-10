import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { patchPptxTextAlignment } from './patchPptxTextAlignment'

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

interface DeckFiles {
  [path: string]: string | Uint8Array
}

async function buildDeck(files: DeckFiles): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'arraybuffer' })
}

async function readXml(buffer: ArrayBuffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  return zip.files[path].async('string')
}

function shapeXml(body: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody>${body}</p:txBody></p:sp>`
}

function placeholderShapeXml(ph: string, body: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="ph"/><p:cNvSpPr/><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${body}</p:txBody></p:sp>`
}

function slideXml(shapes: string): string {
  return `${DECL}<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
}

function layoutXml(shapes: string): string {
  return `${DECL}<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sldLayout>`
}

function relsXml(type: string, target: string): string {
  return `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`
}

describe('patchPptxTextAlignment', () => {
  it('materializes alignment from a shape-level list style (layout text box)', async () => {
    const deck = await buildDeck({
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(
        shapeXml(
          '<a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle><a:p><a:r><a:t>Lab</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(''),
    })

    const patched = await patchPptxTextAlignment(deck)
    const xml = await readXml(patched, 'ppt/slideLayouts/slideLayout1.xml')

    expect(xml).toContain('<a:pPr algn="ctr"')
    expect(xml.startsWith('<?xml')).toBe(true)
  })

  it('materializes alignment inherited from the layout placeholder', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml(
        placeholderShapeXml(
          'type="ctrTitle"',
          '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Weekly</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slides/_rels/slide1.xml.rels': relsXml('slideLayout', '../slideLayouts/slideLayout1.xml'),
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(
        placeholderShapeXml('type="ctrTitle"', '<a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle>'),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(''),
    })

    const patched = await patchPptxTextAlignment(deck)
    const xml = await readXml(patched, 'ppt/slides/slide1.xml')

    expect(xml).toContain('<a:pPr algn="ctr"')
  })

  it('falls through the layout to the master placeholder', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml(
        placeholderShapeXml('type="subTitle" idx="1"', '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Name</a:t></a:r></a:p>'),
      ),
      'ppt/slides/_rels/slide1.xml.rels': relsXml('slideLayout', '../slideLayouts/slideLayout1.xml'),
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(''),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(
        placeholderShapeXml('type="subTitle" idx="1"', '<a:bodyPr/><a:lstStyle><a:lvl1pPr algn="r"/></a:lstStyle>'),
      ),
    })

    const patched = await patchPptxTextAlignment(deck)
    const xml = await readXml(patched, 'ppt/slides/slide1.xml')

    expect(xml).toContain('<a:pPr algn="r"')
  })

  it('honours the paragraph level when picking the list-style entry', async () => {
    const deck = await buildDeck({
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(
        shapeXml(
          '<a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"/><a:lvl2pPr algn="r"/></a:lstStyle><a:p><a:pPr lvl="1"/><a:r><a:t>x</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(''),
    })

    const patched = await patchPptxTextAlignment(deck)
    const xml = await readXml(patched, 'ppt/slideLayouts/slideLayout1.xml')

    expect(xml).toContain('<a:pPr lvl="1" algn="r"')
  })

  it('keeps an alignment the paragraph already states', async () => {
    const deck = await buildDeck({
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(
        shapeXml(
          '<a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle><a:p><a:pPr algn="l"/><a:r><a:t>x</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(''),
    })

    const patched = await patchPptxTextAlignment(deck)
    const xml = await readXml(patched, 'ppt/slideLayouts/slideLayout1.xml')
    const paragraph = /<a:p>.*<\/a:p>/.exec(xml)?.[0] ?? ''

    expect(paragraph).toContain('algn="l"')
    expect(paragraph).not.toContain('algn="ctr"')
  })

  it('leaves paragraphs with no stated alignment untouched', async () => {
    const deck = await buildDeck({
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(
        shapeXml('<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>plain</a:t></a:r></a:p>'),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(''),
    })

    const patched = await patchPptxTextAlignment(deck)

    expect(patched).toBe(deck)
  })

  it('preserves binary parts', async () => {
    const media = new Uint8Array([1, 2, 3, 250, 251])
    const deck = await buildDeck({
      'ppt/slideLayouts/slideLayout1.xml': layoutXml(
        shapeXml(
          '<a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle><a:p><a:r><a:t>x</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': layoutXml(''),
      'ppt/media/image1.png': media,
    })

    const patched = await patchPptxTextAlignment(deck)
    const zip = await JSZip.loadAsync(patched)
    const out = await zip.files['ppt/media/image1.png'].async('uint8array')

    expect(Array.from(out)).toEqual(Array.from(media))
  })

  it('returns the same buffer for non-zip input without throwing', async () => {
    const buffer = new TextEncoder().encode('not a zip').buffer as ArrayBuffer
    expect(await patchPptxTextAlignment(buffer)).toBe(buffer)
  })
})

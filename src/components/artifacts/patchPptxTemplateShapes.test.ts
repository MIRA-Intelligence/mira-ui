import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { patchPptxTemplateShapes } from './patchPptxTemplateShapes'

const NON_PH_SP =
  '<p:sp><p:nvSpPr><p:cNvPr id="7" name="Rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>'
const NON_PH_SP_OPEN =
  '<p:sp><p:nvSpPr><p:cNvPr id="8" name="Textbox"/><p:cNvSpPr/><p:nvPr></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
const PH_SP =
  '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Title"/><p:cNvSpPr/><p:ph type="title"/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>'

function layoutXml(...shapes: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    shapes.join('') +
    '</p:spTree></p:cSld></p:sldLayout>'
  )
}

async function readXml(zip: JSZip, path: string): Promise<string> {
  return (await zip.file(path)!.async('string')) as string
}

describe('patchPptxTemplateShapes', () => {
  it('adds userDrawn to nvPr in non-placeholder shapes of slideLayouts', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('ppt/slides/slide1.xml', NON_PH_SP)
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(NON_PH_SP, NON_PH_SP_OPEN, PH_SP))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await patchPptxTemplateShapes(buffer)
    expect(result).not.toBe(buffer)

    const layout = await readXml(await JSZip.loadAsync(result), 'ppt/slideLayouts/slideLayout1.xml')
    expect(layout).toContain('<p:nvPr userDrawn="1"/>')
    expect(layout).toContain('<p:nvPr userDrawn="1"></p:nvPr>')
    // placeholder shape keeps its unpatched nvPr so prompt text stays hidden
    expect(layout).toContain('<p:ph type="title"/><p:nvPr/>')
    expect(layout).not.toContain('<p:ph type="title"/><p:nvPr userDrawn')
  })

  it('adds userDrawn to nvPr in slideMasters', async () => {
    const zip = new JSZip()
    zip.file('ppt/slideMasters/slideMaster1.xml', layoutXml(NON_PH_SP))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await patchPptxTemplateShapes(buffer)
    const master = await readXml(await JSZip.loadAsync(result), 'ppt/slideMasters/slideMaster1.xml')
    expect(master).toContain('<p:nvPr userDrawn="1"/>')
  })

  it('does not modify slides', async () => {
    const slide = '<p:sld><p:spTree>' + NON_PH_SP + '</p:spTree></p:sld>'
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', slide)
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(NON_PH_SP))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await patchPptxTemplateShapes(buffer)
    expect(await readXml(await JSZip.loadAsync(result), 'ppt/slides/slide1.xml')).toBe(slide)
  })

  it('preserves binary files', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00])
    const zip = new JSZip()
    zip.file('ppt/media/image1.png', bytes)
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(NON_PH_SP))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await patchPptxTemplateShapes(buffer)
    const out = (await (await JSZip.loadAsync(result)).file('ppt/media/image1.png')!.async('uint8array')) as Uint8Array
    expect(Array.from(out)).toEqual(Array.from(bytes))
  })

  it('returns the same buffer when there is nothing to patch', async () => {
    const zip = new JSZip()
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(PH_SP))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    expect(await patchPptxTemplateShapes(buffer)).toBe(buffer)
  })

  it('marks only the unmarked shapes of a partially marked WPS deck', async () => {
    const wpsSp =
      '<p:sp><p:nvSpPr><p:cNvPr id="7" name="Rectangle"/><p:cNvSpPr/><p:nvPr userDrawn="0"/></p:nvSpPr><p:spPr/></p:sp>'
    const zip = new JSZip()
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(wpsSp, NON_PH_SP))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await patchPptxTemplateShapes(buffer)
    expect(result).not.toBe(buffer)

    const layout = await readXml(await JSZip.loadAsync(result), 'ppt/slideLayouts/slideLayout1.xml')
    // the marker WPS itself wrote is left untouched
    expect(layout).toContain('<p:nvPr userDrawn="0"/>')
    expect(layout.match(/userDrawn="1"/g)).toHaveLength(1)
  })

  it('marks connectors, which the library also filters by userDrawn', async () => {
    const connector =
      '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Straight Connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>'
    const zip = new JSZip()
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(connector))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const layout = await readXml(await JSZip.loadAsync(await patchPptxTemplateShapes(buffer)), 'ppt/slideLayouts/slideLayout1.xml')
    expect(layout).toContain('<p:nvPr userDrawn="1"/>')
  })

  it('returns the same buffer when every shape already carries userDrawn', async () => {
    const marked =
      '<p:sp><p:nvSpPr><p:cNvPr id="7" name="Rectangle"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr/></p:sp>'
    const zip = new JSZip()
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml(marked))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    expect(await patchPptxTemplateShapes(buffer)).toBe(buffer)
  })

  it('returns the same buffer for non-zip input without throwing', async () => {
    const buffer = new TextEncoder().encode('not a zip file').buffer as ArrayBuffer

    expect(await patchPptxTemplateShapes(buffer)).toBe(buffer)
  })
})

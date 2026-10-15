import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { patchPptxTextRuns } from './patchPptxTextRuns'

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

function shapeXml(ph: string | null, body: string, id = 2): string {
  const nvPr = ph ? `<p:ph ${ph}/>` : '<p:ph/>'
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s"/><p:cNvSpPr/><p:nvPr>${nvPr}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${body}</p:txBody></p:sp>`
}

function slideXml(shapes: string): string {
  return `${DECL}<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
}

function relsXml(type: string, target: string): string {
  return `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`
}

function defRPr(attrs: string, fillClr: string): string {
  return `<a:lvl1pPr><a:defRPr ${attrs}><a:solidFill><a:${fillClr}/></a:solidFill></a:defRPr></a:lvl1pPr>`
}

async function buildDeck(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) zip.file(path, content)
  return zip.generateAsync({ type: 'arraybuffer' })
}

async function read(buffer: ArrayBuffer, path: string): Promise<string> {
  return (await (await JSZip.loadAsync(buffer)).files[path].async('string')) as string
}

/** Layout with two body placeholders that differ per index — the shape that breaks pptx-preview. */
async function deckWithTwoBodyPlaceholders(runXml: string, paraXml?: string): Promise<ArrayBuffer> {
  return buildDeck({
    'ppt/slides/slide1.xml': slideXml(
      shapeXml('type="body" idx="18"', `<a:bodyPr/><a:lstStyle/><a:p>${paraXml ?? ''}<a:r>${runXml}<a:t>李得瑄</a:t></a:r></a:p>`, 3),
    ),
    'ppt/slides/_rels/slide1.xml.rels': relsXml('slideLayout', '../slideLayouts/slideLayout1.xml'),
    'ppt/slideLayouts/slideLayout1.xml': slideXml(
      shapeXml('type="body" idx="17"', `<a:bodyPr/><a:lstStyle>${defRPr('sz="2000"', 'srgbClr val="F8974A"')}</a:lstStyle>`, 4) +
        shapeXml('type="body" idx="18"', `<a:bodyPr/><a:lstStyle>${defRPr('sz="1800"', 'schemeClr val="bg1"')}</a:lstStyle>`, 5),
    ),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
    'ppt/slideMasters/slideMaster1.xml': slideXml(''),
  })
}

describe('patchPptxTextRuns', () => {
  it('takes run formatting from the placeholder with the same (type, idx), not the first of that type', async () => {
    const deck = await deckWithTwoBodyPlaceholders('<a:rPr lang="zh-CN"/>')
    const xml = await read(await patchPptxTextRuns(deck), 'ppt/slides/slide1.xml')

    expect(xml).toContain('sz="1800"')
    expect(xml).toContain('<a:schemeClr val="bg1"/>')
    expect(xml).not.toContain('F8974A')
  })

  it('creates a run-properties element ahead of the text and keeps schema order', async () => {
    const deck = await deckWithTwoBodyPlaceholders('', '<a:pPr lvl="0"/>')
    const xml = await read(await patchPptxTextRuns(deck), 'ppt/slides/slide1.xml')
    const run = /<a:r>.*?<\/a:r>/.exec(xml)?.[0] ?? ''

    expect(run.startsWith('<a:r><a:rPr')).toBe(true)
    expect(run.indexOf('<a:solidFill>')).toBeLessThan(run.indexOf('<a:t>'))
  })

  it('keeps formatting the run already states', async () => {
    const deck = await deckWithTwoBodyPlaceholders(
      '<a:rPr lang="zh-CN" sz="3200"><a:solidFill><a:srgbClr val="2F318B"/></a:solidFill></a:rPr>',
    )
    const xml = await read(await patchPptxTextRuns(deck), 'ppt/slides/slide1.xml')
    const run = /<a:r>.*?<\/a:r>/.exec(xml)?.[0] ?? ''

    expect(run).toContain('sz="3200"')
    expect(run).toContain('2F318B')
    expect(run).not.toContain('bg1')
  })

  it('places the inherited fill before run children that must follow it', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml(
        shapeXml(
          'type="body" idx="1"',
          '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"><a:latin typeface="微软雅黑"/></a:rPr><a:t>x</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slides/_rels/slide1.xml.rels': relsXml('slideLayout', '../slideLayouts/slideLayout1.xml'),
      'ppt/slideLayouts/slideLayout1.xml': slideXml(
        shapeXml('type="body" idx="1"', `<a:bodyPr/><a:lstStyle>${defRPr('sz="1800"', 'schemeClr val="bg1"')}</a:lstStyle>`),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': slideXml(''),
    })

    const run = /<a:rPr[^>]*>.*?<\/a:rPr>/.exec(await read(await patchPptxTextRuns(deck), 'ppt/slides/slide1.xml'))?.[0] ?? ''
    expect(run.indexOf('<a:solidFill>')).toBeLessThan(run.indexOf('<a:latin'))
  })

  it('uses the list-style entry matching the paragraph level', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml(
        shapeXml(
          'type="body" idx="1"',
          '<a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="zh-CN"/><a:t>level two</a:t></a:r></a:p>',
        ),
      ),
      'ppt/slides/_rels/slide1.xml.rels': relsXml('slideLayout', '../slideLayouts/slideLayout1.xml'),
      'ppt/slideLayouts/slideLayout1.xml': slideXml(
        shapeXml(
          'type="body" idx="1"',
          '<a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="F8974A"/></a:solidFill></a:defRPr></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="1200"><a:solidFill><a:srgbClr val="2F318B"/></a:solidFill></a:defRPr></a:lvl2pPr></a:lstStyle>',
        ),
      ),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': slideXml(''),
    })

    const run = /<a:r>.*?<\/a:r>/.exec(await read(await patchPptxTextRuns(deck), 'ppt/slides/slide1.xml'))?.[0] ?? ''
    expect(run).toContain('sz="1200"')
    expect(run).toContain('2F318B')
    expect(run).not.toContain('F8974A')
  })

  it('returns the same buffer when no run inherits formatting', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml(
        shapeXml(null, '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>plain</a:t></a:r></a:p>'),
      ),
      'ppt/slides/_rels/slide1.xml.rels': relsXml('slideLayout', '../slideLayouts/slideLayout1.xml'),
      'ppt/slideLayouts/slideLayout1.xml': slideXml(''),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml('slideMaster', '../slideMasters/slideMaster1.xml'),
      'ppt/slideMasters/slideMaster1.xml': slideXml(''),
    })

    expect(await patchPptxTextRuns(deck)).toBe(deck)
  })

  it('returns the same buffer for non-zip input without throwing', async () => {
    const buffer = new TextEncoder().encode('not a zip').buffer as ArrayBuffer
    expect(await patchPptxTextRuns(buffer)).toBe(buffer)
  })
})

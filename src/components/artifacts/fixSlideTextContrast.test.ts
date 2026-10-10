import { describe, expect, it } from 'vitest'

import { fixSlideTextContrast } from './fixSlideTextContrast'

interface SlideOptions {
  background?: string
  textColor?: string
  boxBackground?: string
  imageSrc?: string
}

function buildSlide(options: SlideOptions = {}) {
  const container = document.createElement('div')
  const slide = document.createElement('div')
  slide.className = 'pptx-preview-slide-wrapper'
  slide.style.cssText = 'width: 640px; height: 360px; position: relative;'
  if (options.background) {
    slide.style.background = options.background
  }

  const textEl = document.createElement('span')
  textEl.textContent = 'Weekly Report'
  if (options.textColor) {
    textEl.style.color = options.textColor
  }

  if (options.boxBackground) {
    const box = document.createElement('div')
    box.style.background = options.boxBackground
    box.appendChild(textEl)
    slide.appendChild(box)
  } else {
    slide.appendChild(textEl)
  }

  if (options.imageSrc) {
    const imgBox = document.createElement('div')
    imgBox.style.cssText = 'position: absolute; left: 0px; top: 0px; width: 640px; height: 360px;'
    const img = document.createElement('img')
    img.src = options.imageSrc
    imgBox.appendChild(img)
    slide.appendChild(imgBox)
  }

  container.appendChild(slide)
  return { container, span: textEl }
}

describe('fixSlideTextContrast', () => {
  it('darkens near-white text on light solid slide backgrounds', async () => {
    const { container, span } = buildSlide({
      background: 'rgb(255, 255, 255)',
      textColor: 'rgb(255, 255, 255)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(26, 26, 26)')
  })

  it('darkens near-white text when the slide background is a light hex color', async () => {
    const { container, span } = buildSlide({
      background: '#f8fafc',
      textColor: 'rgba(255, 255, 255, 1)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(26, 26, 26)')
  })

  it('keeps white text on dark slide backgrounds', async () => {
    const { container, span } = buildSlide({
      background: 'rgb(15, 23, 42)',
      textColor: 'rgb(255, 255, 255)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('keeps white text sitting on a dark shape inside a light slide', async () => {
    const { container, span } = buildSlide({
      background: 'rgb(255, 255, 255)',
      textColor: 'rgb(255, 255, 255)',
      boxBackground: 'rgb(30, 41, 59)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('leaves non-white text untouched on light slides', async () => {
    const { container, span } = buildSlide({
      background: 'rgb(255, 255, 255)',
      textColor: 'rgb(22, 101, 52)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(22, 101, 52)')
  })

  it('skips slides whose background image cannot be sampled', async () => {
    const { container, span } = buildSlide({
      background: 'rgb(255, 255, 255)',
      textColor: 'rgb(255, 255, 255)',
      imageSrc: 'http://example.com/full-bleed.png',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('is a no-op on containers without slide wrappers', async () => {
    const container = document.createElement('div')
    const span = document.createElement('span')
    span.style.color = 'rgb(255, 255, 255)'
    span.textContent = 'plain'
    container.appendChild(span)
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })
})

interface TemplateSlideOptions {
  layer?: 'slide-layout-wrapper' | 'slide-master-wrapper'
  templateFill?: string
  templateRect?: string
}

/**
 * Builds a slide shaped like the real pptx-preview DOM: a white slide whose
 * template layer carries a filled shape wrapper, and a slide layer carrying
 * the text box on top of it.
 */
function buildTemplateSlide(options: TemplateSlideOptions = {}) {
  const container = document.createElement('div')
  const slide = document.createElement('div')
  slide.className = 'pptx-preview-slide-wrapper'
  slide.style.cssText = 'width: 640px; height: 360px; position: relative;'
  container.appendChild(slide)

  const layer = document.createElement('div')
  layer.className = options.layer ?? 'slide-layout-wrapper'
  const templateShape = document.createElement('div')
  templateShape.className = 'shape-wrapper shape-rect'
  templateShape.style.cssText = options.templateRect ?? 'position: absolute; left: 20px; top: 20px; width: 300px; height: 100px;'
  if (options.templateFill) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('fill', options.templateFill)
    svg.appendChild(rect)
    templateShape.appendChild(svg)
  }
  layer.appendChild(templateShape)
  slide.appendChild(layer)

  const slideLayer = document.createElement('div')
  slideLayer.className = 'slide-wrapper'
  const textShape = document.createElement('div')
  textShape.className = 'shape-wrapper'
  textShape.style.cssText = 'position: absolute; left: 40px; top: 30px; width: 260px; height: 40px;'
  const span = document.createElement('span')
  span.textContent = 'On dark bar'
  span.style.color = 'rgb(255, 255, 255)'
  textShape.appendChild(span)
  slideLayer.appendChild(textShape)
  slide.appendChild(slideLayer)

  container.appendChild(slide)
  return { container, span }
}

describe('fixSlideTextContrast position-aware template layers', () => {
  it('keeps white text on a dark slide-layout rect on a light slide', async () => {
    const { container, span } = buildTemplateSlide({
      templateFill: 'rgba(47, 49, 139, 1)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('keeps white text on a dark slide-master rect on a light slide', async () => {
    const { container, span } = buildTemplateSlide({
      layer: 'slide-master-wrapper',
      templateFill: 'rgba(47, 49, 139, 1)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('darkens white text on a light template rect', async () => {
    const { container, span } = buildTemplateSlide({
      templateFill: 'rgb(255, 255, 255)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(26, 26, 26)')
  })

  it('darkens white text that sits beside (not on) the dark template rect', async () => {
    const { container, span } = buildTemplateSlide({
      templateRect: 'position: absolute; left: 400px; top: 20px; width: 200px; height: 100px;',
      templateFill: 'rgb(20, 20, 20)',
    })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(26, 26, 26)')
  })
})

/** Feeds the canvas sampler a flat image of the given grey level. */
function stubImageSampling(level: number): () => void {
  const originalImage = globalThis.Image
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
    get src(): string {
      return ''
    }
  }
  ;(globalThis as unknown as { Image: unknown }).Image = FakeImage

  const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown }
  const originalContext = proto.getContext
  proto.getContext = () => ({
    drawImage() {},
    getImageData: () => {
      const data = new Uint8ClampedArray(16 * 16 * 4)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = level
        data[i + 1] = level
        data[i + 2] = level
        data[i + 3] = 255
      }
      return { data }
    },
  })
  return () => {
    ;(globalThis as unknown as { Image: unknown }).Image = originalImage
    proto.getContext = originalContext
  }
}

/** Slide whose template layer carries a picture or a banner under the text box. */
function buildBackgroundSlide(options: { imageSrc?: string; banner?: string; src?: string }) {
  const container = document.createElement('div')
  const slide = document.createElement('div')
  slide.className = 'pptx-preview-slide-wrapper'
  slide.style.cssText = 'width: 640px; height: 360px; position: relative;'
  container.appendChild(slide)

  const layer = document.createElement('div')
  layer.className = 'slide-layout-wrapper'
  const backing = document.createElement('div')
  backing.className = 'shape-wrapper shape-rect'
  backing.style.cssText = 'position: absolute; left: 100px; top: 100px; width: 300px; height: 200px;'
  if (options.banner) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('fill', options.banner)
    svg.appendChild(rect)
    backing.appendChild(svg)
  }
  if (options.imageSrc) {
    const img = document.createElement('img')
    img.src = options.imageSrc
    backing.appendChild(img)
  }
  layer.appendChild(backing)
  slide.appendChild(layer)

  const slideLayer = document.createElement('div')
  slideLayer.className = 'slide-wrapper'
  const textShape = document.createElement('div')
  textShape.className = 'shape-wrapper'
  textShape.style.cssText = 'position: absolute; left: 150px; top: 150px; width: 200px; height: 40px;'
  const span = document.createElement('span')
  span.textContent = 'On artwork'
  span.style.color = options.src ?? 'rgb(255, 255, 255)'
  textShape.appendChild(span)
  slideLayer.appendChild(textShape)
  slide.appendChild(slideLayer)

  container.appendChild(slide)
  return { container, span }
}

describe('fixSlideTextContrast over template artwork', () => {
  it('keeps white text that sits on a dark picture', async () => {
    const restore = stubImageSampling(25)
    try {
      const { container, span } = buildBackgroundSlide({ imageSrc: 'data:image/png;base64,dark-sample' })
      await fixSlideTextContrast(container)
      expect(span.style.color).toBe('rgb(255, 255, 255)')
    } finally {
      restore()
    }
  })

  it('darkens white text that sits on a near-white picture', async () => {
    const restore = stubImageSampling(250)
    try {
      const { container, span } = buildBackgroundSlide({ imageSrc: 'data:image/png;base64,light-sample' })
      await fixSlideTextContrast(container)
      expect(span.style.color).toBe('rgb(26, 26, 26)')
    } finally {
      restore()
    }
  })

  it('keeps white text on a mid-tone banner', async () => {
    const { container, span } = buildBackgroundSlide({ banner: 'rgba(248, 151, 74, 1)' })
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('darkens white text beside the artwork, where the slide is white', async () => {
    const { container, span } = buildBackgroundSlide({
      banner: 'rgba(47, 49, 139, 1)',
    })
    container.querySelector<HTMLElement>('.slide-wrapper .shape-wrapper')!.style.left = '600px'
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(26, 26, 26)')
  })
})

/**
 * pptx-preview always gives the slide wrapper a white background and paints the
 * deck's own <p:bg> on a child layer above it, so the child decides.
 */
function buildLayeredBackgroundSlide(layerBackground: string) {
  const container = document.createElement('div')
  const slide = document.createElement('div')
  slide.className = 'pptx-preview-slide-wrapper'
  slide.style.cssText = 'width: 640px; height: 360px; position: relative; background: rgb(255, 255, 255);'
  container.appendChild(slide)

  const layer = document.createElement('div')
  layer.className = 'slide-background'
  layer.style.cssText = `position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; background: ${layerBackground};`
  slide.appendChild(layer)

  const slideLayer = document.createElement('div')
  slideLayer.className = 'slide-wrapper'
  const textShape = document.createElement('div')
  textShape.className = 'shape-wrapper'
  textShape.style.cssText = 'position: absolute; left: 40px; top: 30px; width: 260px; height: 40px;'
  const span = document.createElement('span')
  span.textContent = '甲亢治疗转归研究'
  span.style.color = 'rgb(255, 255, 255)'
  textShape.appendChild(span)
  slideLayer.appendChild(textShape)
  slide.appendChild(slideLayer)

  container.appendChild(slide)
  return { container, span }
}

describe('fixSlideTextContrast slide background layer', () => {
  it('keeps white text when the background layer paints a dark colour over the wrapper default', async () => {
    const { container, span } = buildLayeredBackgroundSlide('rgb(29, 53, 87)')
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(255, 255, 255)')
  })

  it('darkens white text when the background layer is near white', async () => {
    const { container, span } = buildLayeredBackgroundSlide('rgb(247, 249, 252)')
    await fixSlideTextContrast(container)
    expect(span.style.color).toBe('rgb(26, 26, 26)')
  })
})

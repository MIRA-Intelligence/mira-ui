type Rgb = [number, number, number]

const DARK_TEXT_COLOR = 'rgb(26, 26, 26)'
const NEAR_WHITE_MIN = 240
// Below this contrast ratio the text is effectively invisible against its
// background, which is the only case worth repainting. A mid-tone background
// (the decks' orange banner, say) leaves white text perfectly legible, so it
// keeps the colour the author chose.
const MIN_CONTRAST_RATIO = 1.3
const IMAGE_SAMPLE_TIMEOUT_MS = 400

function parseColor(value: string): Rgb | null {
  const rgb = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }
  return null
}

function luminance([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function isNearWhite([r, g, b]: Rgb): boolean {
  return r >= NEAR_WHITE_MIN && g >= NEAR_WHITE_MIN && b >= NEAR_WHITE_MIN
}

function contrastRatio(a: number, b: number): number {
  const [high, low] = a >= b ? [a, b] : [b, a]
  return (high + 0.05) / (low + 0.05)
}

function inlineBackgroundValue(el: Element): string | null {
  const style = el.getAttribute('style') || ''
  const match = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)
  return match ? match[1].trim() : null
}

/** Luminance of the nearest solid background above the span, or null when none states one. */
function ancestorBackgroundLuminance(span: Element, stopAt: Element): number | null {
  let node: Element | null = span
  while (node && node !== stopAt) {
    const value = inlineBackgroundValue(node)
    if (value && !value.includes('url(')) {
      const color = parseColor(value)
      if (color) return luminance(color)
    }
    node = node.parentElement
  }
  return null
}

function styleNumber(style: string, prop: string): number | null {
  const match = new RegExp(`${prop}\\s*:\\s*([\\d.]+)`, 'i').exec(style)
  return match ? Number(match[1]) : null
}

function dataUriFromBackground(value: string): string | null {
  const match = /url\(["']?(data:[^"')]+)["']?\)/.exec(value)
  return match ? match[1] : null
}

function collectImageBoxes(slide: HTMLElement): {
  left: number
  top: number
  width: number
  height: number
  src: string
}[] {
  const boxes: { left: number; top: number; width: number; height: number; src: string }[] = []
  for (const img of slide.querySelectorAll('img')) {
    const boxEl = img.parentElement ?? img
    const style = boxEl.getAttribute('style') || ''
    const width = styleNumber(style, 'width')
    const height = styleNumber(style, 'height')
    if (width !== null && height !== null) {
      boxes.push({
        left: styleNumber(style, 'left') ?? 0,
        top: styleNumber(style, 'top') ?? 0,
        width,
        height,
        src: img.getAttribute('src') || '',
      })
    }
  }
  return boxes
}

async function sampleImageLuminance(src: string): Promise<number | null> {
  if (!src.startsWith('data:')) return null
  return Promise.race([
    new Promise<number | null>((resolve) => {
      const image = new Image()
      image.onload = () => {
        try {
          const size = 16
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(null)
            return
          }
          ctx.drawImage(image, 0, 0, size, size)
          const pixels = ctx.getImageData(0, 0, size, size).data
          let sum = 0
          for (let i = 0; i < pixels.length; i += 4) {
            const alpha = pixels[i + 3] / 255
            sum += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) * alpha
          }
          resolve(sum / (size * size) / 255)
        } catch {
          resolve(null)
        }
      }
      image.onerror = () => resolve(null)
      image.src = src
    }),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), IMAGE_SAMPLE_TIMEOUT_MS)
    }),
  ])
}

const imageLuminanceCache = new Map<string, Promise<number | null>>()

function cachedImageLuminance(src: string): Promise<number | null> {
  let pending = imageLuminanceCache.get(src)
  if (!pending) {
    pending = sampleImageLuminance(src)
    imageLuminanceCache.set(src, pending)
  }
  return pending
}

async function backgroundLuminance(value: string | null): Promise<number | null> {
  if (!value) return null
  if (value.includes('url(')) {
    const src = dataUriFromBackground(value)
    return src ? cachedImageLuminance(src) : null
  }
  const color = parseColor(value)
  return color ? luminance(color) : null
}

async function effectiveBackgroundLuminance(slide: HTMLElement): Promise<number | null> {
  const slideStyle = slide.getAttribute('style') || ''
  const slideWidth = styleNumber(slideStyle, 'width') ?? 640
  const slideHeight = styleNumber(slideStyle, 'height') ?? 360

  // A full-bleed image shape covers the slide background, so its brightness wins.
  for (const box of collectImageBoxes(slide)) {
    const fullBleed =
      box.width >= slideWidth * 0.8 &&
      box.height >= slideHeight * 0.8 &&
      box.left <= slideWidth * 0.05 &&
      box.top <= slideHeight * 0.05
    if (fullBleed) {
      // Unsampleable image means unknown brightness: leave the slide untouched.
      return cachedImageLuminance(box.src)
    }
  }

  // pptx-preview paints the deck's own <p:bg> on a child layer that sits above
  // the wrapper, and gives the wrapper itself a default white background. The
  // child therefore wins: reading the wrapper first reported every dark cover as
  // white and repainted its white title black.
  const layer = slide.querySelector<HTMLElement>('.slide-background')
  if (layer) {
    const fromLayer = await backgroundLuminance(inlineBackgroundValue(layer))
    if (fromLayer !== null) return fromLayer
  }

  const fromSlide = await backgroundLuminance(inlineBackgroundValue(slide))
  if (fromSlide !== null) return fromSlide

  // pptx-preview falls back to a white slide background.
  return 1
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

function rectOf(el: Element): Rect | null {
  const style = el.getAttribute('style') || ''
  const left = styleNumber(style, 'left')
  const top = styleNumber(style, 'top')
  const width = styleNumber(style, 'width')
  const height = styleNumber(style, 'height')
  if (left === null || top === null || width === null || height === null) return null
  return { left, top, width, height }
}

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height
}

/** Fill of a shape-wrapper's svg rect, or null when it does not cover (no rect / transparent). */
function shapeFillColor(el: Element): string | null {
  const rect = el.querySelector('rect')
  const fill = rect ? rect.getAttribute('fill') : null
  if (!fill || fill === 'transparent' || fill === 'none') return null
  return fill
}

/**
 * Brightness of the topmost thing that actually covers (x, y): a shape's fill,
 * a picture, or nothing. Scans paint order top → bottom — slide shapes, then the
 * template layers, then master — because template boxes and photos are what hide
 * behind slide text. `luminance: null` marks a picture that could not be
 * sampled, which callers treat as unknown rather than guessing.
 */
async function coveringBackground(
  slide: HTMLElement,
  x: number,
  y: number,
): Promise<{ luminance: number | null } | null> {
  for (const layerClass of ['slide-wrapper', 'slide-layout-wrapper', 'slide-master-wrapper']) {
    const layer = slide.querySelector<HTMLElement>(`.${layerClass}`)
    if (!layer) continue
    const shapes = Array.from(layer.children)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i]
      const rect = rectOf(shape)
      if (!rect || !pointInRect(x, y, rect)) continue
      const fill = shapeFillColor(shape)
      if (fill) {
        const color = parseColor(fill)
        return { luminance: color ? luminance(color) : null }
      }
      const image = shape.querySelector('img')
      const src = image ? image.getAttribute('src') || '' : ''
      if (src.startsWith('data:')) {
        return { luminance: await cachedImageLuminance(src) }
      }
    }
  }
  return null
}

/** Background brightness that decides the span's readability; null means unknown, so leave it be. */
async function backgroundUnderSpan(slide: HTMLElement, span: HTMLElement): Promise<number | null> {
  const ancestor = ancestorBackgroundLuminance(span, slide)
  if (ancestor !== null) return ancestor

  const fallback = await effectiveBackgroundLuminance(slide)
  const own = span.closest<HTMLElement>('.shape-wrapper')
  if (!own) return fallback
  const rect = rectOf(own)
  if (!rect) return fallback

  const covering = await coveringBackground(slide, rect.left + rect.width / 2, rect.top + rect.height / 2)
  if (!covering) return fallback
  return covering.luminance
}

async function patchSlide(slide: HTMLElement): Promise<void> {
  // A full-bleed image the canvas cannot read leaves the whole slide alone.
  if ((await effectiveBackgroundLuminance(slide)) === null) return

  for (const span of slide.querySelectorAll<HTMLElement>('span')) {
    const color = span.style.color
    if (!color) continue
    const rgb = parseColor(color)
    if (!rgb || !isNearWhite(rgb)) continue
    const background = await backgroundUnderSpan(slide, span)
    if (background === null) continue
    if (contrastRatio(luminance(rgb), background) >= MIN_CONTRAST_RATIO) continue
    span.style.color = DARK_TEXT_COLOR
  }
}

/**
 * Decks routinely store white or near-white text that the author relies on a
 * coloured banner or photo sitting behind it. When that artwork is dropped — or
 * simply is not there — the text renders white-on-white and vanishes. This
 * repaints only the spans whose own background leaves them unreadable, leaving
 * text on dark, mid-tone or image backgrounds in the colour the deck chose.
 */
export async function fixSlideTextContrast(container: HTMLElement): Promise<void> {
  const slides = container.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper')
  for (const slide of Array.from(slides)) {
    await patchSlide(slide)
  }
}

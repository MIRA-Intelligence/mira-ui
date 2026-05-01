import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ImageLightboxProps {
  src: string
  alt: string
  onClose: () => void
  onOpenOriginal?: () => void
  onDownload?: () => void
}

const MIN_SCALE = 0.05
const MAX_SCALE = 40
const WHEEL_ZOOM_SPEED = 0.0015
const PINCH_ZOOM_SPEED = 0.01

interface Transform {
  scale: number
  tx: number
  ty: number
}

export function ImageLightbox({
  src,
  alt,
  onClose,
  onOpenOriginal,
  onDownload,
}: ImageLightboxProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  const [fitScale, setFitScale] = useState<number>(1)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; baseTx: number; baseTy: number } | null>(null)

  const fitToStage = useCallback((natural: { w: number; h: number }) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const margin = 32
    const sx = (rect.width - margin * 2) / natural.w
    const sy = (rect.height - margin * 2) / natural.h
    const fit = Math.min(sx, sy, 1)
    const safeFit = Number.isFinite(fit) && fit > 0 ? fit : 1
    setFitScale(safeFit)
    setTransform({ scale: safeFit, tx: 0, ty: 0 })
  }, [])

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    const natural = { w: img.naturalWidth, h: img.naturalHeight }
    setNaturalSize(natural)
    setLoaded(true)
    fitToStage(natural)
  }, [fitToStage])

  // Re-fit on viewport resize (so the image stays bounded if the user resizes
  // the window while the lightbox is open). We only auto-refit while the user
  // hasn't manually zoomed past `fit`; otherwise their zoom intent is kept.
  useLayoutEffect(() => {
    if (!naturalSize) return
    const onResize = () => {
      // Only re-fit if user hasn't actively zoomed beyond the fit baseline.
      if (Math.abs(transform.scale - fitScale) < 0.001) {
        fitToStage(naturalSize)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [naturalSize, fitScale, transform.scale, fitToStage])

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    setTransform((prev) => {
      const stage = stageRef.current
      if (!stage) return prev
      const rect = stage.getBoundingClientRect()
      const cx = clientX - rect.left - rect.width / 2
      const cy = clientY - rect.top - rect.height / 2
      const nextScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE)
      const k = nextScale / prev.scale
      return {
        scale: nextScale,
        tx: cx - (cx - prev.tx) * k,
        ty: cy - (cy - prev.ty) * k,
      }
    })
  }, [])

  const setScaleCentered = useCallback((nextScale: number) => {
    setTransform((prev) => {
      const k = clamp(nextScale, MIN_SCALE, MAX_SCALE) / prev.scale
      return {
        scale: clamp(nextScale, MIN_SCALE, MAX_SCALE),
        tx: prev.tx * k,
        ty: prev.ty * k,
      }
    })
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!loaded) return
    e.preventDefault()
    // Trackpad pinch on macOS arrives as a wheel event with `ctrlKey: true`.
    const speed = e.ctrlKey ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED
    const factor = Math.exp(-e.deltaY * speed)
    zoomAt(e.clientX, e.clientY, factor)
  }, [loaded, zoomAt])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!loaded) return
    if (e.button !== 0) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseTx: transform.tx,
      baseTy: transform.ty,
    }
    e.preventDefault()
  }, [loaded, transform.tx, transform.ty])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setTransform((prev) => ({
        ...prev,
        tx: drag.baseTx + (e.clientX - drag.startX),
        ty: drag.baseTy + (e.clientY - drag.startY),
      }))
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!loaded) return
    // Toggle between fit and 1:1 (centered on the click).
    const isAtFit = Math.abs(transform.scale - fitScale) < 0.001
    if (isAtFit) {
      const factor = 1 / transform.scale
      zoomAt(e.clientX, e.clientY, factor)
    } else if (naturalSize) {
      fitToStage(naturalSize)
    }
  }, [loaded, transform.scale, fitScale, naturalSize, zoomAt, fitToStage])

  // Keyboard: ESC closes; + / - / = zoom; 0 / 1 toggle to 1:1; F refits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (!loaded) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setScaleCentered(transform.scale * 1.25)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setScaleCentered(transform.scale / 1.25)
      } else if (e.key === '0' || e.key === '1') {
        e.preventDefault()
        setScaleCentered(1)
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        if (naturalSize) fitToStage(naturalSize)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loaded, onClose, transform.scale, setScaleCentered, naturalSize, fitToStage])

  // Stop background scrolling while open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  if (typeof document === 'undefined') return null

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[1000] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <Toolbar
        zoomPercent={Math.round(transform.scale * 100)}
        onFit={() => naturalSize && fitToStage(naturalSize)}
        onActualSize={() => setScaleCentered(1)}
        onZoomIn={() => setScaleCentered(transform.scale * 1.25)}
        onZoomOut={() => setScaleCentered(transform.scale / 1.25)}
        onOpenOriginal={onOpenOriginal}
        onDownload={onDownload}
        onClose={onClose}
      />
      <div
        ref={stageRef}
        className="relative flex-1 overflow-hidden"
        style={{ cursor: dragRef.current ? 'grabbing' : loaded ? 'grab' : 'default' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 select-none"
          style={{
            transform: `translate(-50%, -50%) translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
            willChange: 'transform',
            transition: dragRef.current ? 'none' : 'transform 60ms linear',
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={handleImageLoad}
            onError={() => setError(true)}
            className="max-w-none block"
            style={{ imageRendering: transform.scale >= 2 ? 'pixelated' : 'auto' }}
          />
        </div>
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
            Loading…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
            Failed to load image
          </div>
        )}
      </div>
      <div className="px-4 py-1.5 text-[10px] text-white/50 text-center select-none">
        Scroll / pinch to zoom · drag to pan · double-click to toggle 1:1 · Esc to close
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}

function Toolbar({
  zoomPercent,
  onFit,
  onActualSize,
  onZoomIn,
  onZoomOut,
  onOpenOriginal,
  onDownload,
  onClose,
}: {
  zoomPercent: number
  onFit: () => void
  onActualSize: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onOpenOriginal?: () => void
  onDownload?: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 text-white/85 text-xs bg-black/30">
      <ToolButton onClick={onZoomOut} title="Zoom out (−)">−</ToolButton>
      <span className="px-2 tabular-nums text-[11px] min-w-[3.5rem] text-center">{zoomPercent}%</span>
      <ToolButton onClick={onZoomIn} title="Zoom in (+)">+</ToolButton>
      <span className="mx-1 h-4 w-px bg-white/20" />
      <ToolButton onClick={onFit} title="Fit to screen (F)">Fit</ToolButton>
      <ToolButton onClick={onActualSize} title="Actual size (1)">1:1</ToolButton>
      <span className="ml-auto flex items-center gap-1">
        {onOpenOriginal && (
          <ToolButton onClick={onOpenOriginal} title="Open original in new window">
            ↗ Original
          </ToolButton>
        )}
        {onDownload && (
          <ToolButton onClick={onDownload} title="Download">
            ⬇ Download
          </ToolButton>
        )}
        <ToolButton onClick={onClose} title="Close (Esc)">×</ToolButton>
      </span>
    </div>
  )
}

function ToolButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-2 py-1 rounded hover:bg-white/15 active:bg-white/25 text-[12px] leading-none transition-colors"
    >
      {children}
    </button>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { StatusBarItems } from '../EngineStatusBar'
import { Icon } from '../common/icons'
import { useCommand } from '../../state/commands'
import { errorText } from '../../state/errorText'
import './image-viewer.css'

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif'
}
const clampZoom = (zoom: number) => Math.min(20, Math.max(0.1, zoom))

export function isImageFile(file: string): boolean {
  const dot = file.lastIndexOf('.')
  return dot > Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) && Object.hasOwn(MIME, file.slice(dot + 1).toLowerCase())
}

type View = { zoom: number; x: number; y: number; fit: boolean }
type Source = { url: string; size: number; id: number }
type Dimensions = { width: number; height: number }

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function ImageViewer({ projectId, file, active, onClose, onViewSource, sourceText }: {
  projectId: string
  file: string
  active: boolean
  onClose: () => void
  onViewSource?: () => void
  sourceText?: string
}) {
  const stage = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [source, setSource] = useState<Source | null>(null)
  const [dimensions, setDimensions] = useState<Dimensions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, fit: true })
  const suffix = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  const extension = isImageFile(file) ? suffix : undefined
  const format = extension === 'jpg' ? 'JPEG' : extension?.toUpperCase()
  const ready = !!dimensions && !error

  useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0, fit: true })
  }, [projectId, file])

  useEffect(() => {
    const id = ++request.current
    let alive = true
    setSource(null)
    const pointerId = drag.current?.id
    drag.current = null
    setDragging(false)
    if (pointerId !== undefined && stage.current?.hasPointerCapture(pointerId)) stage.current.releasePointerCapture(pointerId)
    setDimensions(null)
    setError(null)

    const load = async () => {
      try {
        if (!extension) throw new Error('Định dạng ảnh không được hỗ trợ')
        if (extension === 'svg' && sourceText !== undefined) {
          const bytes = new TextEncoder().encode(sourceText)
          const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
          if (alive) setSource({ url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, size: bytes.byteLength, id })
        } else {
          const readBinary = window.nexgraph.fs.readBinary
          if (!readBinary) throw new Error('Không thể đọc tệp ảnh trong môi trường này')
          const result = await readBinary(projectId, file)
          if (alive) setSource({ url: `data:${MIME[extension]};base64,${result.data}`, size: result.size, id })
        }
      } catch (e) {
        if (alive) setError(errorText(e))
      }
    }
    void load()
    return () => { alive = false }
  }, [projectId, file, extension, sourceText])

  const fitToView = useCallback(() => {
    const rect = stage.current?.getBoundingClientRect()
    if (!dimensions || !rect?.width || !rect.height) {
      setView((current) => ({ ...current, fit: true }))
      return
    }
    const zoom = clampZoom(Math.min(1, rect.width / dimensions.width, rect.height / dimensions.height))
    setView((current) => current.fit && current.zoom === zoom && current.x === 0 && current.y === 0
      ? current : { zoom, x: 0, y: 0, fit: true })
  }, [dimensions])

  useEffect(() => {
    const element = stage.current
    if (!active || !view.fit || !dimensions || !element) return
    fitToView()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitToView)
      return () => window.removeEventListener('resize', fitToView)
    }
    const observer = new ResizeObserver(fitToView)
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, dimensions, fitToView, view.fit])

  const zoomBy = useCallback((factor: number, point?: { x: number; y: number }) => {
    const rect = stage.current?.getBoundingClientRect()
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor)
      if (zoom === current.zoom) return current
      if (!point || !rect) return { ...current, zoom, fit: false }
      const x = point.x - rect.left - rect.width / 2
      const y = point.y - rect.top - rect.height / 2
      const ratio = zoom / current.zoom
      return {
        zoom,
        x: Math.round((x - (x - current.x) * ratio) * 1000) / 1000,
        y: Math.round((y - (y - current.y) * ratio) * 1000) / 1000,
        fit: false
      }
    })
  }, [])

  const resetZoom = useCallback(() => setView({ zoom: 1, x: 0, y: 0, fit: false }), [])
  const move = (x: number, y: number) => setView((current) => ({ ...current, x: current.x + x, y: current.y + y, fit: false }))

  useCommand('image.zoom_in', () => zoomBy(1.1), active && ready)
  useCommand('image.zoom_out', () => zoomBy(1 / 1.1), active && ready)
  useCommand('image.reset_zoom', resetZoom, active && ready)
  useCommand('image.fit_to_view', fitToView, active && ready)

  useEffect(() => {
    const element = stage.current
    if (!active || !ready || !element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, { x: event.clientX, y: event.clientY })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [active, ready, zoomBy])

  useEffect(() => {
    if (!active) {
      const pointerId = drag.current?.id
      drag.current = null
      if (pointerId !== undefined && stage.current?.hasPointerCapture(pointerId)) stage.current.releasePointerCapture(pointerId)
      setDragging(false)
    }
  }, [active])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0 || drag.current) return
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: view.x, y: view.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const dragImage = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    const x = event.clientX - start.startX
    const y = event.clientY - start.startY
    setView((current) => ({ ...current, x: start.x + x, y: start.y + y, fit: x !== 0 || y !== 0 ? false : current.fit }))
  }
  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="code-viewer editor-tab image-viewer" style={active ? undefined : { display: 'none' }}>
      <header className="code-head image-viewer-head">
        <span className="image-viewer-path mono" title={file}>{file}</span>
        <div className="image-viewer-actions">
          {extension === 'svg' && onViewSource && <button type="button" className="image-viewer-button" aria-label="Xem mã nguồn SVG" onClick={onViewSource}>Mã nguồn</button>}
          <button type="button" className="image-viewer-button image-viewer-icon" aria-label="Đóng ảnh" title="Đóng ảnh" onClick={onClose}><Icon name="close" size={15} /></button>
        </div>
      </header>
      <div className="image-viewer-toolbar" role="toolbar" aria-label="Điều khiển ảnh">
        <button type="button" className="image-viewer-button image-viewer-icon" aria-label="Thu nhỏ" title="Thu nhỏ" disabled={!ready || view.zoom <= 0.1} onClick={() => zoomBy(1 / 1.1)}><Icon name="minus" size={15} /></button>
        <button type="button" className="image-viewer-button image-viewer-zoom" aria-label={`Tỷ lệ ${Math.round(view.zoom * 100)}%, đặt về 100%`} title="Kích thước thực" disabled={!ready} onClick={resetZoom}>{Math.round(view.zoom * 100)}%</button>
        <button type="button" className="image-viewer-button image-viewer-icon" aria-label="Phóng to" title="Phóng to" disabled={!ready || view.zoom >= 20} onClick={() => zoomBy(1.1)}><Icon name="plus" size={15} /></button>
        <button type="button" className="image-viewer-button" disabled={!ready} onClick={fitToView}>Vừa khung</button>
        <span className="image-viewer-divider" />
        <div className="image-viewer-actions" role="group" aria-label="Di chuyển ảnh">
          <button type="button" className="image-viewer-button image-viewer-icon" aria-label="Di chuyển ảnh sang trái" title="Di chuyển ảnh sang trái" disabled={!ready} onClick={() => move(-32, 0)}><Icon name="back" size={15} /></button>
          <button type="button" className="image-viewer-button image-viewer-icon image-viewer-up" aria-label="Di chuyển ảnh lên" title="Di chuyển ảnh lên" disabled={!ready} onClick={() => move(0, -32)}><Icon name="chevron" size={15} /></button>
          <button type="button" className="image-viewer-button image-viewer-icon image-viewer-down" aria-label="Di chuyển ảnh xuống" title="Di chuyển ảnh xuống" disabled={!ready} onClick={() => move(0, 32)}><Icon name="chevron" size={15} /></button>
          <button type="button" className="image-viewer-button image-viewer-icon" aria-label="Di chuyển ảnh sang phải" title="Di chuyển ảnh sang phải" disabled={!ready} onClick={() => move(32, 0)}><Icon name="chevron" size={15} /></button>
        </div>
      </div>
      <div ref={stage} className="image-viewer-stage" data-dragging={dragging || undefined} role="region" aria-label="Khung xem ảnh" tabIndex={0}
        onPointerDown={startDrag} onPointerMove={dragImage} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
        onKeyDown={(event) => {
          if (!ready) return
          const delta: Record<string, [number, number]> = { ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32] }
          const direction = delta[event.key]
          if (direction) { event.preventDefault(); move(...direction) }
        }}>
        {!dimensions && !error && <p role="status" className="image-viewer-message">Đang mở ảnh…</p>}
        {error && <p role="alert" className="image-viewer-message error">{error}</p>}
        {source && !error && <img key={source.id} className="image-viewer-image" alt={`Ảnh ${file}`} src={source.url} draggable={false}
          style={{ opacity: dimensions ? 1 : 0, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          onLoad={(event) => {
            if (source.id !== request.current) return
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget
            if (width && height) setDimensions({ width, height })
            else setError(errorText(new Error('Không xác định được kích thước ảnh')))
          }}
          onError={() => { if (source.id === request.current) setError(errorText(new Error('Không thể giải mã ảnh'))) }} />}
      </div>
      {active && dimensions && source && !error && <StatusBarItems><span className="status-item">{dimensions.width} × {dimensions.height} • {formatSize(source.size)} • {format}</span></StatusBarItems>}
    </div>
  )
}

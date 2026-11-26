// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineStatusBar } from '../../shared/ui/EngineStatusBar'
import { runCommand } from '../../shared/lib/commands'
import { installNexgraph } from '../../test-utils'
import { ImageViewer, isImageFile } from './ImageViewer'

const props = { projectId: 'p1', file: 'images/test.png', active: true, onClose: () => {} }
const status = <EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} />
afterEach(() => vi.restoreAllMocks())

async function openImage() {
  installNexgraph({ fs: { readBinary: vi.fn(async () => ({ data: 'aW1hZ2U=', size: 5 })) } })
  const result = render(<><ImageViewer {...props} />{status}</>)
  const stage = screen.getByRole('region', { name: 'Khung xem ảnh' })
  const bounds = vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect)
  const image = await screen.findByAltText('Ảnh images/test.png')
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 800 },
    naturalHeight: { configurable: true, value: 400 }
  })
  fireEvent.load(image)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tỷ lệ 50%, đặt về 100%' })).toBeEnabled())
  return { ...result, stage, image, bounds }
}

describe('ImageViewer', () => {
  it('recognizes supported image extensions without confusing path components', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif']) {
      expect(isImageFile(`ảnh/HÌNH.${ext.toUpperCase()}`)).toBe(true)
    }
    expect(isImageFile('ảnh.png/file.txt')).toBe(false)
    expect(isImageFile('ảnh.png\\file')).toBe(false)
    expect(isImageFile('ảnh.svg.bak')).toBe(false)
    expect(isImageFile('ảnh')).toBe(false)
    expect(isImageFile('ảnh.constructor')).toBe(false)
    expect(isImageFile('ảnh.png\n')).toBe(false)
  })

  it('fits, zooms around the pointer, clamps the zoom and preserves it while hidden', async () => {
    const { stage, image, rerender } = await openImage()
    expect(screen.getByLabelText('Thanh trạng thái')).toHaveTextContent('800 × 400 • 5 B • PNG')
    fireEvent.wheel(stage, { deltaY: -1, clientX: 300, clientY: 150 })
    expect(screen.getByRole('button', { name: 'Tỷ lệ 55%, đặt về 100%' })).toBeInTheDocument()
    expect(image.style.transform).toContain('translate(-10px, 0px)')
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(image.style.transform).toContain('translate(22px, 0px)')
    fireEvent.click(screen.getByRole('button', { name: 'Di chuyển ảnh lên' }))
    expect(image.style.transform).toContain('translate(22px, -32px)')

    rerender(<><ImageViewer {...props} active={false} />{status}</>)
    act(() => { expect(runCommand('image.zoom_in')).toBe(false) })
    rerender(<><ImageViewer {...props} />{status}</>)
    expect(screen.getByRole('button', { name: 'Tỷ lệ 55%, đặt về 100%' })).toBeInTheDocument()
    act(() => { expect(runCommand('image.reset_zoom')).toBe(true) })
    expect(screen.getByRole('button', { name: 'Tỷ lệ 100%, đặt về 100%' })).toBeInTheDocument()
    act(() => { expect(runCommand('image.fit_to_view')).toBe(true) })
    expect(screen.getByRole('button', { name: 'Tỷ lệ 50%, đặt về 100%' })).toBeInTheDocument()

    for (let i = 0; i < 70; i++) fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    expect(screen.getByRole('button', { name: 'Tỷ lệ 2000%, đặt về 100%' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Phóng to' })).toBeDisabled()
    for (let i = 0; i < 90; i++) fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }))
    expect(screen.getByRole('button', { name: 'Tỷ lệ 10%, đặt về 100%' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeDisabled()
  })

  it('does not enlarge small images when fitting', async () => {
    const { bounds } = await openImage()
    bounds.mockReturnValue({ left: 0, top: 0, width: 1600, height: 1000 } as DOMRect)
    act(() => { expect(runCommand('image.fit_to_view')).toBe(true) })
    expect(screen.getByRole('button', { name: 'Tỷ lệ 100%, đặt về 100%' })).toBeInTheDocument()
  })

  it('previews unsaved SVG text as a data URL and offers the source toggle', async () => {
    installNexgraph()
    const onViewSource = vi.fn()
    const text = '<svg xmlns="http://www.w3.org/2000/svg"><text># &amp; Việt</text></svg>'
    const { rerender } = render(<ImageViewer {...props} file="drawing.svg" sourceText={text} onViewSource={onViewSource} />)
    const image = await screen.findByAltText('Ảnh drawing.svg')
    const src = image.getAttribute('src')!
    expect(src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(src.slice(src.indexOf(',') + 1))).toBe(text)
    const stage = screen.getByRole('region', { name: 'Khung xem ảnh' })
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect)
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 400 } })
    fireEvent.load(image)
    expect(screen.getByRole('button', { name: 'Tỷ lệ 50%, đặt về 100%' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xem mã nguồn SVG' }))
    expect(onViewSource).toHaveBeenCalledOnce()
    rerender(<ImageViewer {...props} file="drawing.svg" sourceText={'<svg>\uD800</svg>'} onViewSource={onViewSource} />)
    await waitFor(() => expect(decodeURIComponent(screen.getByAltText('Ảnh drawing.svg').getAttribute('src')!.split(',').slice(1).join(','))).toBe('<svg>\uFFFD</svg>'))
    const updated = screen.getByAltText('Ảnh drawing.svg')
    Object.defineProperties(updated, { naturalWidth: { value: 800 }, naturalHeight: { value: 400 } })
    fireEvent.load(updated)
    expect(screen.getByRole('button', { name: 'Tỷ lệ 55%, đặt về 100%' })).toBeEnabled()
    rerender(<ImageViewer {...props} file="drawing.svg" sourceText="<svg/>" onViewSource={onViewSource} />)
    const invalid = await screen.findByAltText('Ảnh drawing.svg')
    fireEvent.error(invalid)
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể giải mã ảnh')
  })

  it('shows the message from a failed binary read', async () => {
    installNexgraph({ fs: { readBinary: vi.fn(async () => { throw { message: 'Không thể đọc tệp' } }) } })
    render(<ImageViewer {...props} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không thể đọc tệp'))
  })
})

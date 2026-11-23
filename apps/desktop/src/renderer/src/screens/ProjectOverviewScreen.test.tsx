// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, project } from '../test-utils'
import { ProjectOverviewScreen } from './ProjectOverviewScreen'

const stats = { files: 12, nodes_by_kind: { file: 12, function: 30 }, edges_by_type: { CALLS: 40, IMPORTS: 8 }, languages: { dart: 12 }, unresolved: 0 }
const indexed = project({ last_indexed_at: 1_700_000_000 })

const renderOverview = (over: Parameters<typeof installNexgraph>[0] = {}) => {
  const h = installNexgraph({ ...over, graph: { stats: vi.fn(async () => stats), ...over.graph } })
  const props = { onOpenWorkspace: vi.fn(), onReindex: vi.fn(), onBack: vi.fn() }
  render(<ProjectOverviewScreen project={indexed} {...props} />)
  return { ...h, props }
}

describe('ProjectOverviewScreen', () => {
  it('thẻ có mô tả dài vẫn có title đầy đủ để đọc khi bị giới hạn 2 dòng', async () => {
    renderOverview()
    const desc = await screen.findByText('Đọc lại toàn bộ mã nguồn và dựng graph mới.')
    expect(desc).toHaveAttribute('title', 'Đọc lại toàn bộ mã nguồn và dựng graph mới.')
    expect(desc.closest('button')).toHaveAttribute('title', 'Đọc lại toàn bộ mã nguồn và dựng graph mới.')
  })

  it('báo ngôn ngữ ở mức chung khi dự án có Go/Java', async () => {
    renderOverview({ graph: { stats: vi.fn(async () => ({ ...stats, generic_languages: ['go', 'java'] })) } })
    expect(await screen.findByRole('note')).toHaveTextContent('mức chung')
    expect(screen.getByRole('note')).toHaveTextContent('go, java')
  })

  it('hiện số liệu graph và huy hiệu khi graph cũ hơn mã nguồn', async () => {
    renderOverview({ graph: { stats: vi.fn(async () => ({ ...stats, stale: true, changed_files: 1 })) } })
    expect(await screen.findByLabelText('12 tệp · 42 node · 48 cạnh')).toBeInTheDocument()
    expect(await screen.findByText('Graph cũ hơn mã nguồn')).toBeInTheDocument()
  })

  it('shows a failed stats request and lets the user reload it', async () => {
    const get = vi.fn(async () => ({ ...stats, changed_files: null }))
      .mockRejectedValueOnce(new Error('engine indisponible'))
    renderOverview({ graph: { stats: get } })
    expect(await screen.findByRole('alert')).toHaveTextContent('engine indisponible')
    await userEvent.click(screen.getByRole('button', { name: 'Tải lại số liệu' }))
    expect(await screen.findByText('Chưa xác minh được đồ thị có khớp với mã nguồn hiện tại.')).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('thẻ Xem mở workspace đúng tab', async () => {
    const { props } = renderOverview()
    await userEvent.click(screen.getByRole('button', { name: /^Báo cáo/ }))
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('report')
    await userEvent.click(screen.getByRole('button', { name: /^Luồng/ }))
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('flows')
    await userEvent.click(screen.getByRole('button', { name: /^Cây/ }))
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('tree')
  })

  it('gom cụm lại hiện số cụm', async () => {
    const { api } = renderOverview({ graph: { recluster: vi.fn(async () => ({ communities: 4 })) } })
    await userEvent.click(screen.getByRole('button', { name: /^Gom cụm lại/ }))
    expect(api.graph.recluster).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('Đã chia 4 cụm')).toBeInTheDocument()
  })

  it('tuỳ chọn index gửi mẫu bỏ qua', async () => {
    const { props } = renderOverview()
    await userEvent.click(screen.getByRole('button', { name: /^Tuỳ chọn index/ }))
    await userEvent.type(screen.getByLabelText('Mẫu bỏ qua'), 'gen/{Enter}vendor/{Enter}{Enter}')
    expect(screen.getByLabelText(/Số tiến trình/)).not.toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
    expect(props.onReindex).toHaveBeenCalledWith({ exclude: ['gen/', 'vendor/'], includeDocs: false, includeMedia: false, includeConfig: false, force: false,
      sources: { postgres: false, cargo: false, manifests: false, scipFiles: [], mcpFiles: [] } })
  })

  it('tuỳ chọn index gồm tài liệu, audio/video chỉ bật được sau khi bật tài liệu', async () => {
    const { props } = renderOverview()
    await userEvent.click(screen.getByRole('button', { name: /^Tuỳ chọn index/ }))
    const media = screen.getByLabelText(/Gồm audio\/video/)
    expect(media).toBeDisabled()
    await userEvent.click(screen.getByLabelText(/Gồm tài liệu/))
    expect(media).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
    expect(props.onReindex).toHaveBeenCalledWith({ exclude: [], includeDocs: true, includeMedia: false, includeConfig: false, force: false,
      sources: { postgres: false, cargo: false, manifests: false, scipFiles: [], mcpFiles: [] } })
  })

  it('thiếu faster-whisper thì khoá ô audio/video và nói cần cài', async () => {
    renderOverview({ engine: { tools: vi.fn(async () => ({ ffmpeg: true, faster_whisper: false, git: true, gh: false, yt_dlp: false })) } })
    await userEvent.click(screen.getByRole('button', { name: /^Tuỳ chọn index/ }))
    await userEvent.click(screen.getByLabelText(/Gồm tài liệu/))
    expect(await screen.findByText(/Cần faster-whisper: chạy engine từ mã nguồn/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Gồm audio\/video/)).toBeDisabled()
  })

  it('index lại không có mẫu bỏ qua', async () => {
    const { props } = renderOverview()
    await userEvent.click(screen.getByRole('button', { name: /^Index lại/ }))
    expect(props.onReindex).toHaveBeenCalledWith({ exclude: [] })
  })

  it('sao chép cấu hình MCP', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { api } = renderOverview({ mcp: { config: vi.fn(async () => ({ stdio: '{"mcpServers":{}}' })) } })
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép cấu hình MCP' }))
    expect(api.mcp.config).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"mcpServers":{}}'))
    expect(await screen.findByText('Đã sao chép')).toBeInTheDocument()
  })

  it('bật MCP qua HTTP hiện URL, key ẩn tới khi bấm hiện', async () => {
    const { api } = renderOverview({ mcp: { startHttp: vi.fn(async () => ({ url: 'http://127.0.0.1:5555/mcp', key: 'abc123' })) } })
    await userEvent.click(await screen.findByRole('switch', { name: 'MCP qua HTTP' }))
    expect(api.mcp.startHttp).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('http://127.0.0.1:5555/mcp')).toBeInTheDocument()
    expect(screen.queryByText('abc123')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hiện key' }))
    expect(screen.getByText('abc123')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'MCP qua HTTP' }))
    expect(api.mcp.stopHttp).toHaveBeenCalledWith('p1')
  })

  it('thẻ Phân tích ngữ nghĩa mở hộp thoại bật AI (mặc định tắt)', async () => {
    renderOverview()
    const card = await screen.findByRole('button', { name: /Phân tích ngữ nghĩa bằng AI/ })
    await waitFor(() => expect(card).toHaveTextContent('Đang tắt'))
    await userEvent.click(card)
    expect(await screen.findByRole('dialog', { name: 'Phân tích ngữ nghĩa bằng AI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bật AI cho dự án' })).toBeDisabled()
  })

  it('nút Đặt tên cụm bằng AI nằm trong nhóm Dựng graph', async () => {
    renderOverview()
    await userEvent.click(await screen.findByRole('button', { name: /Đặt tên cụm bằng AI/ }))
    expect(await screen.findByRole('dialog', { name: 'Đặt tên cụm bằng AI' })).toBeInTheDocument()
  })
})

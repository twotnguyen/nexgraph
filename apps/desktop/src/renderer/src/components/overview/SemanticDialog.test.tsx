// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { SemanticDialog } from './SemanticDialog'

const result = { target: 'docs', nodes_added: 4, edges_added: 6, labels: {}, merged: 0, triage: null, errors: [],
  usage: { input_tokens: 1500, output_tokens: 200 },
  chunks: { total: 2, cached: 0, sent: 2, done: 1, failed: 1, skipped_budget: 0 } }
const done = { job_id: 'sem1', project_id: 'p1', kind: 'semantic', state: 'done' as const, files_done: 2, files_total: 2, message: null, result }

describe('SemanticDialog', () => {
  it('AI tắt mặc định: phải đồng ý mới bật, rồi xem ước tính và chạy', async () => {
    const { api } = installNexgraph({ index: { status: vi.fn(async () => done) } })
    render(<SemanticDialog projectId="p1" onClose={() => {}} />)
    const enable = await screen.findByRole('button', { name: 'Bật AI cho dự án' })
    expect(enable).toBeDisabled()
    expect(api.semantic.estimate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByLabelText(/Engine gọi trực tiếp/))
    await userEvent.click(screen.getByLabelText(/Tôi đồng ý/))
    await userEvent.click(enable)
    expect(api.semantic.setSettings).toHaveBeenCalledWith('p1', { enabled: true, transport: 'direct', model: null })
    expect(await screen.findByText('1 tệp · 1 khối (0 khối đã có sẵn kết quả)')).toBeInTheDocument()
    expect(screen.getByText('Model: openai / gpt-test')).toBeInTheDocument()
    expect(api.semantic.estimate).toHaveBeenCalledWith('p1', 'docs', false)
    await userEvent.click(screen.getByRole('button', { name: 'Đồng ý và chạy' }))
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'docs', undefined, false)
    expect(await screen.findByText('Xong: thêm 4 node, 6 quan hệ suy luận bởi AI.')).toBeInTheDocument()
    expect(screen.getByText(/1 khối lỗi/)).toBeInTheDocument()
    expect(screen.getByText(/Đã dùng 1\.500 token đầu vào/)).toBeInTheDocument()
  })

  it('AI-08: Gộp khái niệm trùng chạy được khi chưa bật AI, không bắt đồng ý', async () => {
    const merged = { ...done, result: { ...result, target: 'dedup', merged: 3 } }
    const { api } = installNexgraph({ index: { status: vi.fn(async () => merged) } })
    render(<SemanticDialog projectId="p1" onClose={() => {}} />)
    await userEvent.click(await screen.findByLabelText(/Gộp khái niệm trùng/))
    expect(screen.queryByRole('button', { name: 'Bật AI cho dự án' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Tôi đồng ý/)).not.toBeInTheDocument()
    expect(screen.getByText('Không gửi gì: chạy trên máy.')).toBeInTheDocument()
    const run = screen.getByRole('button', { name: 'Chạy gộp trên máy' })
    expect(run).toBeEnabled()
    await userEvent.click(run)
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'dedup', undefined, false)
    expect(await screen.findByText('Xong: gộp 3 khái niệm trùng.')).toBeInTheDocument()
  })

  it('nút Đặt tên cụm chạy target labels', async () => {
    const labels = { ...done, result: { ...result, target: 'labels', labels: { 1: 'Thanh toán', 2: 'Kho' } } }
    const { api } = installNexgraph({
      index: { status: vi.fn(async () => labels) },
      semantic: { getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'openai / gpt-test' })) }
    })
    render(<SemanticDialog projectId="p1" target="labels" onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và chạy' }))
    expect(api.semantic.estimate).toHaveBeenCalledWith('p1', 'labels', false)
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'labels', undefined, false)
    expect(await screen.findByText('Xong: đặt tên 2 cụm.')).toBeInTheDocument()
  })

  it('xếp hạng pull request: hiện thứ tự và việc cần làm do AI đề xuất', async () => {
    const triage = { ...done, result: { ...result, target: 'pr_triage', triage: [{ number: 8, priority: 1, action: 'Review ngay.' }] } }
    const { api } = installNexgraph({
      index: { status: vi.fn(async () => triage) },
      semantic: { getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'openai / gpt-test' })) }
    })
    render(<SemanticDialog projectId="p1" target="pr_triage" onClose={() => {}} />)
    expect(await screen.findByRole('dialog', { name: 'Xếp hạng pull request bằng AI' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và chạy' }))
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'pr_triage', undefined, false)
    expect(await screen.findByText('#8 · ưu tiên 1: Review ngay.')).toBeInTheDocument()
  })

  it('không có tài liệu thì không cho chạy', async () => {
    installNexgraph({ semantic: {
      getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'm' })),
      estimate: vi.fn(async () => ({ files: [], chunks: 0, cached_chunks: 0, input_tokens: 0, output_tokens: 0 })) } })
    render(<SemanticDialog projectId="p1" onClose={() => {}} />)
    expect(await screen.findByText(/Bật "Gồm tài liệu"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đồng ý và chạy' })).toBeDisabled()
  })
})

describe('SemanticDialog — sửa sau kiểm thử', () => {
  it('hiện model sẽ dùng thật và chặn chạy khi model khác lúc đồng ý', async () => {
    const { api } = installNexgraph({ semantic: {
      getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'openai / gpt-cu' })),
      estimate: vi.fn(async () => ({ files: ['README.md'], chunks: 1, cached_chunks: 0, input_tokens: 10, output_tokens: 5, model: 'google / gemini-moi' })) } })
    render(<SemanticDialog projectId="p1" onClose={() => {}} />)
    expect(await screen.findByText('Model: google / gemini-moi')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('google / gemini-moi')
    expect(screen.getByRole('button', { name: 'Đồng ý và chạy' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Đồng ý dùng model mới' }))
    expect(api.semantic.setSettings).toHaveBeenCalledWith('p1', { enabled: true, transport: 'app', model: null })
  })

  it('M2: dedup khi AI đang bật vẫn là nút chạy trên máy, không phải "Đồng ý và chạy"', async () => {
    installNexgraph({ semantic: {
      getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'openai / gpt-test' })) } })
    render(<SemanticDialog projectId="p1" onClose={() => {}} />)
    await userEvent.click(await screen.findByLabelText(/Gộp khái niệm trùng/))
    expect(screen.getByText('Không gửi gì: chạy trên máy.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Đồng ý và chạy' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Chạy gộp trên máy' })).toBeEnabled()
  })

  it('câu đồng ý nêu đúng thứ gửi đi theo target', async () => {
    installNexgraph()
    render(<SemanticDialog projectId="p1" target="labels" onClose={() => {}} />)
    expect(await screen.findByLabelText(/tên symbol và tên tệp của từng cụm/)).toBeInTheDocument()
  })

  it('ảnh: nêu rõ sẽ gửi ảnh; chạy lại không dùng cache', async () => {
    const { api } = installNexgraph({ semantic: {
      getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'openai / gpt-test' })) } })
    render(<SemanticDialog projectId="p1" onClose={() => {}} />)
    await userEvent.click(await screen.findByLabelText(/Ảnh \(cần model/))
    expect(screen.getByText('Sẽ gửi: các tệp ảnh của dự án.')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Chạy lại, không dùng kết quả đã lưu'))
    expect(api.semantic.estimate).toHaveBeenLastCalledWith('p1', 'images', true)
    await screen.findByText('Model: openai / gpt-test')
    await userEvent.click(screen.getByRole('button', { name: 'Đồng ý và chạy' }))
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'images', undefined, true)
  })
})

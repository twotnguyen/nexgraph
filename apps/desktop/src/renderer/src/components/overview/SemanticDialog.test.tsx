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
    expect(api.semantic.estimate).toHaveBeenCalledWith('p1', 'docs')
    await userEvent.click(screen.getByRole('button', { name: 'Đồng ý và chạy' }))
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'docs')
    expect(await screen.findByText('Xong: thêm 4 node, 6 quan hệ suy luận bởi AI.')).toBeInTheDocument()
    expect(screen.getByText(/1 khối lỗi/)).toBeInTheDocument()
    expect(screen.getByText(/Đã dùng 1\.500 token đầu vào/)).toBeInTheDocument()
  })

  it('nút Đặt tên cụm chạy target labels', async () => {
    const labels = { ...done, result: { ...result, target: 'labels', labels: { 1: 'Thanh toán', 2: 'Kho' } } }
    const { api } = installNexgraph({
      index: { status: vi.fn(async () => labels) },
      semantic: { getSettings: vi.fn(async () => ({ enabled: true, transport: 'app' as const, model: 'openai / gpt-test' })) }
    })
    render(<SemanticDialog projectId="p1" target="labels" onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và chạy' }))
    expect(api.semantic.estimate).toHaveBeenCalledWith('p1', 'labels')
    expect(api.semantic.start).toHaveBeenCalledWith('p1', 'labels')
    expect(await screen.findByText('Xong: đặt tên 2 cụm.')).toBeInTheDocument()
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

// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { IntegrationPlan } from '@shared/integration-types'
import { installNexgraph, project } from '../../test-utils'
import { IntegrationsDialog } from './IntegrationsDialog'

const plan = (over: Partial<IntegrationPlan> = {}): IntegrationPlan => ({ agent: 'cursor', path: '/p/.cursor/mcp.json', exists: false, status: 'new',
  after: '{"mcpServers":{}}\n', snippet: '{"mcpServers":{"nexgraph":{}}}', ...over })
const open = (mcp: Record<string, unknown>) => {
  const h = installNexgraph({ mcp })
  render(<IntegrationsDialog project={project()} onClose={() => {}} />)
  return h
}

describe('IntegrationsDialog', () => {
  it('chọn Cursor: xem trước đường dẫn, nhãn Tệp mới, nội dung; Ghi gọi apply', async () => {
    const apply = vi.fn(async () => plan())
    const { api } = open({ plan: vi.fn(async () => plan()), apply })
    await userEvent.click(screen.getByRole('radio', { name: 'Cursor' }))
    expect(await screen.findByText('/p/.cursor/mcp.json')).toBeInTheDocument()
    expect(api.mcp.plan).toHaveBeenLastCalledWith('cursor', expect.any(String))
    expect(screen.getByText('Tệp mới')).toBeInTheDocument()
    expect(screen.getByText(/"mcpServers":\{\}/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ghi tệp này' }))
    expect(apply).toHaveBeenCalledWith('cursor', expect.any(String))
    expect(await screen.findByText('Đã ghi /p/.cursor/mcp.json')).toBeInTheDocument()
  })

  it('up_to_date: nút ghi bị vô hiệu', async () => {
    open({ plan: vi.fn(async () => plan({ status: 'up_to_date', exists: true })) })
    expect(await screen.findByText('Đã cài, không cần ghi lại')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghi tệp này' })).toBeDisabled()
  })

  it('invalid: hiện câu invalid, không có nút ghi, vẫn sao chép được', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    open({ plan: vi.fn(async () => plan({ status: 'invalid', exists: true, after: '' })) })
    expect(await screen.findByRole('alert')).toHaveTextContent('không phải JSON hợp lệ')
    expect(screen.queryByRole('button', { name: 'Ghi tệp này' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép cấu hình' }))
    expect(writeText).toHaveBeenCalledWith('{"mcpServers":{"nexgraph":{}}}')
  })

  it('tệp đã có: nhãn "chỉ thêm mục nexgraph", nút Cập nhật khi status update', async () => {
    open({ plan: vi.fn(async () => plan({ status: 'update', exists: true })) })
    expect(await screen.findByText('Tệp đã có, chỉ thêm mục nexgraph')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeEnabled()
  })
})

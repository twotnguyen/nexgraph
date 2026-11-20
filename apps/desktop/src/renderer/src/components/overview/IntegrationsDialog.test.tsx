// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { IntegrationPlan } from '@shared/integration-types'
import { installNexgraph, project } from '../../test-utils'
import { IntegrationsDialog } from './IntegrationsDialog'

const plan = (over: Partial<IntegrationPlan> = {}): IntegrationPlan => ({ agent: 'cursor', part: 'mcp', path: '/p/.cursor/mcp.json', exists: false, status: 'new',
  after: '{"mcpServers":{}}\n', snippet: '{"mcpServers":{"nexgraph":{}}}', ...over })
const rule = (over: Partial<IntegrationPlan> = {}): IntegrationPlan =>
  plan({ part: 'rules', path: '/p/.cursor/rules/nexgraph.mdc', after: '---\nalwaysApply: true\n---\n', ...over })
const open = (mcp: Record<string, unknown>) => {
  const h = installNexgraph({ mcp })
  render(<IntegrationsDialog project={project()} onClose={() => {}} />)
  return h
}
const choose = (label: string) => userEvent.selectOptions(screen.getByRole('combobox', { name: 'Trợ lý' }), label)

describe('IntegrationsDialog', () => {
  it('đủ 21 nền tảng trong danh sách', () => {
    open({ plan: vi.fn(async () => []) })
    expect(within(screen.getByRole('combobox', { name: 'Trợ lý' })).getAllByRole('option')).toHaveLength(21)
  })

  it('chọn Cursor: mỗi phần hiện đường dẫn, nhãn, nội dung; Ghi gọi apply', async () => {
    const apply = vi.fn(async () => [plan(), rule()])
    const { api } = open({ plan: vi.fn(async () => [plan(), rule()]), apply })
    await choose('Cursor')
    expect(await screen.findByText('/p/.cursor/mcp.json')).toBeInTheDocument()
    expect(api.mcp.plan).toHaveBeenLastCalledWith('cursor', expect.any(String), undefined)
    const mcp = screen.getByRole('region', { name: 'Cấu hình MCP' })
    expect(within(mcp).getByText('Tệp mới')).toBeInTheDocument()
    expect(within(mcp).getByText(/"mcpServers":\{\}/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Quy tắc hỏi graph trước' })).getByText('/p/.cursor/rules/nexgraph.mdc')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ghi các tệp này' }))
    expect(apply).toHaveBeenCalledWith('cursor', expect.any(String), undefined)
    expect(await screen.findByText('Đã ghi /p/.cursor/mcp.json · Đã ghi /p/.cursor/rules/nexgraph.mdc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghi các tệp này' })).toBeDisabled()
  })

  it('mọi phần up_to_date: nút ghi bị vô hiệu', async () => {
    open({ plan: vi.fn(async () => [plan({ status: 'up_to_date', exists: true })]) })
    expect(await screen.findByText('Đã cài, không cần ghi lại')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghi các tệp này' })).toBeDisabled()
  })

  it('phần invalid: hiện câu invalid và nút sao chép riêng; các phần khác vẫn ghi được', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    open({ plan: vi.fn(async () => [plan({ status: 'invalid', exists: true, after: '' }), rule()]) })
    expect(await screen.findByRole('alert')).toHaveTextContent('không phải JSON hợp lệ')
    expect(screen.getByRole('button', { name: 'Ghi các tệp này' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép' }))
    expect(writeText).toHaveBeenCalledWith('{"mcpServers":{"nexgraph":{}}}')
  })

  it('tất cả là update: nút Cập nhật', async () => {
    open({ plan: vi.fn(async () => [plan({ status: 'update', exists: true })]) })
    expect(await screen.findByText('Tệp đã có, chỉ thêm mục nexgraph')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeEnabled()
  })

  it('Codex: TOML đã có thì báo dán tay; có ghi chú tin cậy', async () => {
    const planFn = vi.fn(async () => [plan({ agent: 'codex', path: '/p/.codex/config.toml', exists: true, status: 'invalid', after: '' })])
    open({ plan: planFn })
    await choose('Codex')
    expect(await screen.findByText('/p/.codex/config.toml')).toBeInTheDocument()
    expect(planFn).toHaveBeenLastCalledWith('codex', expect.any(String), undefined)
    expect(screen.getByText('Codex chỉ đọc .codex/config.toml của dự án khi dự án đã được đánh dấu tin cậy trong Codex.')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp .codex/config.toml đã có nên NexGraph không sửa (TOML)')
  })

  it('skill đã có nội dung khác: câu không ghi đè', async () => {
    open({ plan: vi.fn(async () => [plan({ agent: 'claude', part: 'skill', path: '/p/.claude/skills/nexgraph/SKILL.md', exists: true, status: 'invalid', after: '' })]) })
    expect(await screen.findByRole('alert')).toHaveTextContent('SKILL.md')
  })

  it('strict chỉ có ở Claude Code và CodeBuddy, bật thì plan với strict', async () => {
    const planFn = vi.fn(async () => [plan({ agent: 'claude', part: 'hook', path: '/p/.claude/settings.json' })])
    open({ plan: planFn })
    const box = await screen.findByRole('checkbox', { name: /chế độ nghiêm/ })
    expect(planFn).toHaveBeenLastCalledWith('claude', expect.any(String), { strict: false })
    await userEvent.click(box)
    expect(planFn).toHaveBeenLastCalledWith('claude', expect.any(String), { strict: true })
    await choose('Cursor')
    expect(screen.queryByRole('checkbox', { name: /chế độ nghiêm/ })).toBeNull()
  })

  it('Gỡ: xem trước phần sẽ gỡ, xác nhận gọi remove', async () => {
    const planRemove = vi.fn(async () => [plan({ status: 'remove', exists: true, after: '{"mcpServers":{"other":{}}}\n' }), rule({ status: 'delete', exists: true, after: '' })])
    const remove = vi.fn(async () => [plan({ status: 'remove' }), rule({ status: 'delete' })])
    open({ plan: vi.fn(async () => [plan({ status: 'up_to_date', exists: true })]), planRemove, remove })
    await screen.findByText('Đã cài, không cần ghi lại')
    await userEvent.click(screen.getByRole('button', { name: 'Gỡ…' }))
    expect(await screen.findByText('Bỏ mục nexgraph, giữ phần còn lại')).toBeInTheDocument()
    expect(screen.getByText('Xoá tệp')).toBeInTheDocument()
    expect(screen.getByText(/"other"/)).toBeInTheDocument()
    expect(planRemove).toHaveBeenCalledWith('claude', expect.any(String))
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận gỡ' }))
    expect(remove).toHaveBeenCalledWith('claude', expect.any(String))
    expect(await screen.findByText('Đã gỡ NexGraph khỏi các tệp trên')).toBeInTheDocument()
  })
})

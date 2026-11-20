// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { NodeMemory } from './NodeMemory'

describe('NodeMemory', () => {
  it('hiện bài học và ghi nhớ của nút, thêm ghi nhớ tay rồi tải lại', async () => {
    const { api } = installNexgraph()
    vi.mocked(api.memory.recall).mockResolvedValue({
      node_id: 'a#file', node_exists: true, lesson: { status: 'tentative', node: 'a#file', n: 1, score: 1 },
      memories: [{ id: 1, kind: 'incident', text: 'Từng lỗi đăng nhập', node_ids: ['a#file', 'b#file'], missing_node_ids: ['b#file'],
        outcome: null, created_at: 0, source: 'mcp' }]
    })
    vi.mocked(api.memory.add).mockResolvedValueOnce({ id: 1, created: false })
    render(<NodeMemory projectId="p1" nodeId="a#file" />)
    expect(await screen.findByText('Mới được đánh giá hữu ích một lần')).toBeInTheDocument()
    expect(screen.getByText(/Từng lỗi đăng nhập/)).toHaveTextContent('1 nút không còn trong đồ thị')
    await userEvent.selectOptions(screen.getByLabelText('Loại ghi nhớ'), 'owner')
    await userEvent.type(screen.getByLabelText('Nội dung ghi nhớ'), 'Nhóm A')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm ghi nhớ' }))
    expect(api.memory.add).toHaveBeenCalledWith('p1', 'owner', 'Nhóm A', ['a#file'])
    expect(await screen.findByRole('status')).toHaveTextContent('Đã có ghi nhớ này.')
    expect(api.memory.recall).toHaveBeenCalledTimes(2)
  })
})

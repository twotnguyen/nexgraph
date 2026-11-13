// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode } from '@shared/graph-types'
import { NodeContextMenu } from './NodeContextMenu'

const node: GraphNode = { id: 'lib/a.dart::A.run#method', kind: 'method', label: 'run', qualified_name: 'A.run', language: 'dart',
  file: 'lib/a.dart', line_start: 3, line_end: 9, is_test: false, origin: 'ast', signature: null, community: null }

describe('NodeContextMenu', () => {
  it('runs each action with the node and closes', async () => {
    const h = { onFindPath: vi.fn(), onImpact: vi.fn(), onExport: vi.fn(), onClose: vi.fn() }
    render(<NodeContextMenu node={node} x={10} y={20} {...h} />)
    expect(screen.getByRole('menu', { name: 'run' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tìm đường tới…' }))
    expect(h.onFindPath).toHaveBeenCalledWith(node)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Vùng ảnh hưởng nếu sửa' }))
    expect(h.onImpact).toHaveBeenCalledWith(node)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Xuất vùng này…' }))
    expect(h.onExport).toHaveBeenCalledWith(node)
    expect(h.onClose).toHaveBeenCalledTimes(3)
  })

  it('closes with Escape', async () => {
    const onClose = vi.fn()
    render(<NodeContextMenu node={node} x={0} y={0} onFindPath={vi.fn()} onImpact={vi.fn()} onExport={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

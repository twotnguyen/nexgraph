// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ArchEvidence } from '@nexgraph/contracts/graph-types'
import { EvidencePopover } from './EvidencePopover'

const item = (over: Partial<ArchEvidence['edge']> = {}, file = 'lib/a.dart', line = 12): ArchEvidence => ({
  file, line,
  edge: { id: 1, source: 'lib/a.dart::A.run#method', target: 'lib/b.dart::B.go#method', type: 'CALLS', subtype: null,
    confidence: 'INFERRED', confidence_score: 0.9, origin: 'resolver', evidence: { file, line, col: 4 }, ...over }
})

const props = { loading: false, error: null, onOpenNode: vi.fn(), onClose: vi.fn() }

describe('EvidencePopover', () => {
  it('lists file:line, edge type and short names', () => {
    render(<EvidencePopover {...props} title="screens → services" items={[item(), item({ id: 2, type: 'IMPORTS', source: 'lib/a.dart#file', target: 'lib/b.dart#file' }, 'lib/a.dart', 3)]} />)
    expect(screen.getByRole('dialog', { name: 'Bằng chứng' })).toBeInTheDocument()
    expect(screen.getByText('screens → services')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /lib\/a\.dart:12/ })).toHaveTextContent('CALLS')
    expect(screen.getByRole('button', { name: /lib\/a\.dart:12/ })).toHaveTextContent('A.run → B.go')
    expect(screen.getByRole('button', { name: /lib\/a\.dart:3/ })).toHaveTextContent('a.dart → b.dart')
  })

  it('opens the source node of an item', async () => {
    const onOpenNode = vi.fn()
    render(<EvidencePopover {...props} onOpenNode={onOpenNode} items={[item()]} />)
    await userEvent.click(screen.getByRole('button', { name: /lib\/a\.dart:12/ }))
    expect(onOpenNode).toHaveBeenCalledWith('lib/a.dart::A.run#method')
  })

  it('closes with Escape and with the close button', async () => {
    const onClose = vi.fn()
    render(<EvidencePopover {...props} onClose={onClose} items={[item()]} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows loading, error and empty states', () => {
    const { rerender } = render(<EvidencePopover {...props} loading items={[]} />)
    expect(screen.getByText('Đang tải…')).toBeInTheDocument()
    rerender(<EvidencePopover {...props} error="Không có khối" items={[]} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Không có khối')
    rerender(<EvidencePopover {...props} items={[]} />)
    expect(screen.getByText('Không có bằng chứng')).toBeInTheDocument()
  })
})

describe('EvidencePopover with code viewer', () => {
  it('opens the code at file:line and keeps a separate button for the node', async () => {
    const onOpenCode = vi.fn()
    const onOpenNode = vi.fn()
    render(<EvidencePopover {...props} onOpenNode={onOpenNode} onOpenCode={onOpenCode} items={[item()]} />)
    await userEvent.click(screen.getByRole('button', { name: /lib\/a\.dart:12/ }))
    expect(onOpenCode).toHaveBeenCalledWith('lib/a.dart', 12)
    expect(onOpenNode).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Xem nút' }))
    expect(onOpenNode).toHaveBeenCalledWith('lib/a.dart::A.run#method')
  })
})

// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../shared/lib/locale'
import { FlowList } from './FlowList'

afterEach(() => setLocale('vi'))

const props = {
  flows: [],
  total: 0,
  selectedId: null,
  onSelect: vi.fn(),
  query: '',
  onQueryChange: vi.fn(),
  onKindChange: vi.fn(),
  truncated: false
}

describe('FlowList', () => {
  it('nhãn chip loại luồng đổi ngay khi đổi ngôn ngữ (không chốt lúc nạp module)', () => {
    render(<FlowList {...props} />)
    expect(screen.getByRole('button', { name: 'Tất cả' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sự kiện' })).toBeInTheDocument()
    act(() => setLocale('en'))
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'event' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tất cả' })).toBeNull()
    act(() => setLocale('vi'))
    expect(screen.getByRole('button', { name: 'Tất cả' })).toBeInTheDocument()
  })
})

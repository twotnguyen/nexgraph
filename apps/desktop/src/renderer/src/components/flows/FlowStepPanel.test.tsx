// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlowStep } from '@shared/graph-types'
import { setLocale } from '../../state/locale'
import { FlowStepPanel } from './FlowStepPanel'

const step = (label: string): FlowStep => ({
  order: 1, depth: 0, caller: null, line: 3,
  node: { id: `${label}#function`, kind: 'function', label, qualified_name: label, language: 'python',
    file: 'src/app.py', line_start: 10, line_end: 20, is_test: false, origin: 'ast', signature: null, community: null }
})

const props = {
  steps: [step('run')], currentIndex: 0, onSelectStep: () => {}, onOpenCode: () => {}, onOpenNode: () => {},
  codeSlice: 'def run():\n    pass'
}

describe('FlowStepPanel — dấu hiệu đoạn mã bị cắt (UI-TRUNC)', () => {
  afterEach(() => setLocale('vi'))

  it('không hiện dòng cắt khi engine trả đủ đoạn', () => {
    render(<FlowStepPanel {...props} />)
    expect(screen.queryByText('Đã cắt bớt — mở tệp để xem đầy đủ')).not.toBeInTheDocument()
  })

  it('hiện dòng cắt khi CodeSlice.truncated = true', () => {
    render(<FlowStepPanel {...props} codeTruncated />)
    expect(screen.getByRole('status')).toHaveTextContent('Đã cắt bớt — mở tệp để xem đầy đủ')
  })

  it('bản Anh dùng câu tương ứng', () => {
    setLocale('en')
    render(<FlowStepPanel {...props} codeTruncated />)
    expect(screen.getByRole('status')).toHaveTextContent('Truncated — open the file to see it in full')
  })
})

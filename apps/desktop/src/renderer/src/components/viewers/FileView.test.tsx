// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../state/commands'
import { FileView } from './FileView'

afterEach(() => cleanup())

const state = vi.hoisted(() => ({ text: 'a,b\n"1,5",2', mounts: 0, loadError: null as string | null }))
vi.mock('./modelBuffer', () => ({
  observeBuffer: (_projectId: string, _file: string, changed: (text: string | null) => void) => {
    changed(state.text)
    return { edit: () => {}, dispose: () => {} }
  }
}))
// Monaco không chạy trong jsdom: EditorTab giả đếm số lần gắn kết để kiểm tra trình soạn thảo không bị dựng lại.
// vi.mock được nâng lên trước import tĩnh nên factory phải nạp react bằng import().
vi.mock('../editor/EditorTab', async () => {
  const React = await import('react')
  return {
    EditorTab: (props: { active?: boolean; onViewTable?: () => void; onLoadError?: (file: string, error: string | null) => void }) => {
      React.useEffect(() => { state.mounts++; props.onLoadError?.('data.csv', state.loadError) }, [])
      return React.createElement('div', { 'data-testid': 'editor', 'data-active': String(props.active) },
        props.onViewTable && React.createElement('button', { onClick: props.onViewTable }, 'Xem bảng'))
    }
  }
})

const props = { projectId: 'p1', line: 1, onClose: () => {}, onDirtyChange: () => {} }

describe('FileView CSV/TSV', () => {
  beforeEach(() => { state.mounts = 0; state.loadError = null })

  it('mở ở mã nguồn; chuyển bảng/nguồn không dựng lại trình soạn thảo nên giữ sửa đổi chưa lưu', () => {
    render(<FileView {...props} file="data.csv" />)
    expect(screen.queryByRole('table')).toBeNull()
    const editor = screen.getByTestId('editor')
    fireEvent.click(screen.getByRole('button', { name: 'Xem bảng' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('1,5')).toBeInTheDocument()
    expect(screen.getByTestId('editor')).toBe(editor)
    expect(editor).toHaveAttribute('data-active', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Xem mã nguồn' }))
    expect(screen.queryByRole('table')).toBeNull()
    expect(editor).toHaveAttribute('data-active', 'true')
    expect(state.mounts).toBe(1)
  })

  it('lệnh table.preview chỉ có ở thẻ CSV/TSV đang hiện và chuyển qua lại', () => {
    const view = render(<FileView {...props} file="data.tsv" active={false} />)
    expect(runCommand('table.preview')).toBe(false)
    view.rerender(<FileView {...props} file="data.tsv" active />)
    act(() => { expect(runCommand('table.preview')).toBe(true) })
    expect(screen.getByRole('table')).toBeInTheDocument()
    act(() => { expect(runCommand('table.preview')).toBe(true) })
    expect(screen.queryByRole('table')).toBeNull()
    view.rerender(<FileView {...props} file="data.tsv" active={false} />)
    expect(runCommand('table.preview')).toBe(false)
  })

  it('tệp khác không có nút bảng và không nhận lệnh', () => {
    render(<FileView {...props} file="data.csv.bak" />)
    expect(screen.queryByRole('button', { name: 'Xem bảng' })).toBeNull()
    expect(runCommand('table.preview')).toBe(false)
  })

  it('lỗi nạp của trình soạn thảo hiện trong bảng và vẫn chuyển tiếp cho màn hình', () => {
    state.text = null as unknown as string
    state.loadError = 'Không đọc được tệp'
    const onLoadError = vi.fn()
    render(<FileView {...props} file="data.csv" onLoadError={onLoadError} />)
    fireEvent.click(screen.getByRole('button', { name: 'Xem bảng' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được tệp')
    expect(onLoadError).toHaveBeenCalledWith('data.csv', 'Không đọc được tệp')
    state.text = 'a,b\n"1,5",2'
  })
})

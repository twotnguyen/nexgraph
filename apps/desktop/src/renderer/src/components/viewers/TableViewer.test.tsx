// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_ROWS, TableViewer } from './TableViewer'

afterEach(() => cleanup())

const buffer = vi.hoisted(() => ({ text: null as string | null, notify: null as ((value: string | null) => void) | null }))
vi.mock('./modelBuffer', () => ({
  observeBuffer: (_projectId: string, _file: string, changed: (text: string | null) => void) => {
    buffer.notify = changed
    changed(buffer.text)
    return { edit: () => {}, dispose: () => { buffer.notify = null } }
  }
}))

const open = (file = 'data.csv', props: Partial<Parameters<typeof TableViewer>[0]> = {}) =>
  render(<TableViewer projectId="p1" file={file} onViewSource={() => {}} {...props} />)
const texts = (nodes: HTMLElement[]) => nodes.map((node) => node.textContent)
const dataRows = (count: number) => Array.from({ length: count }, (_, index) => `r${index}`).join('\n')

describe('TableViewer', () => {
  it('dòng đầu là tiêu đề; ô trong ngoặc kép giữ dấu phẩy và dấu ngoặc kép; cột # là dòng nguồn', () => {
    buffer.text = 'tên,địa chỉ,ghi chú\n"Nguyễn, Văn A","12 Lê Lợi, Q1","nói ""chào"""\nBình,,\n'
    open()
    expect(texts(screen.getAllByRole('columnheader'))).toEqual(['#', 'tên', 'địa chỉ', 'ghi chú'])
    expect(texts(screen.getAllByRole('cell'))).toEqual(['Nguyễn, Văn A', '12 Lê Lợi, Q1', 'nói "chào"', 'Bình', '', ''])
    expect(texts(screen.getAllByRole('rowheader'))).toEqual(['2', '3'])
  })

  it('ô xuống dòng làm bản ghi sau có số dòng nguồn đúng', () => {
    buffer.text = 'a,b\n"x\ny",1\nz,2'
    open()
    expect(texts(screen.getAllByRole('rowheader'))).toEqual(['2', '4'])
    expect(screen.getAllByRole('cell')[0]).toHaveAttribute('title', 'x\ny')
  })

  it('dòng thiếu cột được bù ô trống; cột không có tên hiện "Cột N"', () => {
    buffer.text = 'a,,c\n1\n1,2,3,4'
    open()
    expect(texts(screen.getAllByRole('columnheader'))).toEqual(['#', 'a', 'Cột 2', 'c', 'Cột 4'])
    const [short, long] = screen.getAllByRole('row').slice(1)
    expect(texts(within(short).getAllByRole('cell'))).toEqual(['1', '', '', ''])
    expect(texts(within(long).getAllByRole('cell'))).toEqual(['1', '2', '3', '4'])
  })

  it('TSV tách bằng tab, dấu phẩy là chữ thường', () => {
    buffer.text = 'a\tb,c\n1\t2'
    open('x.tsv')
    expect(texts(screen.getAllByRole('columnheader'))).toEqual(['#', 'a', 'b,c'])
  })

  it('cập nhật khi bộ đệm đổi, kể cả chưa lưu', () => {
    buffer.text = 'a,b\n1,2'
    open()
    act(() => { buffer.notify?.('a,b\n1,2\n3,4') })
    expect(texts(screen.getAllByRole('rowheader'))).toEqual(['2', '3'])
  })

  it(`chỉ dựng ${MAX_ROWS} dòng dữ liệu và báo bị cắt khi còn nữa`, () => {
    buffer.text = `h\n${dataRows(MAX_ROWS)}`
    const { unmount } = open()
    expect(screen.getAllByRole('rowheader')).toHaveLength(MAX_ROWS)
    expect(screen.queryByRole('status')).toBeNull()
    unmount()
    buffer.text = `h\n${dataRows(MAX_ROWS + 1)}\n`
    open()
    expect(screen.getAllByRole('rowheader')).toHaveLength(MAX_ROWS)
    expect(screen.getByRole('status')).toHaveTextContent(`Chỉ hiển thị ${MAX_ROWS} dòng dữ liệu đầu tiên`)
  }, 30_000)

  it('báo đang mở, không có dữ liệu hoặc lỗi nạp thay vì bảng trống', () => {
    buffer.text = null
    const { unmount } = open()
    expect(screen.getByText('Đang mở nội dung…')).toBeInTheDocument()
    unmount()
    buffer.text = '\n  \n'
    const second = open()
    expect(screen.getByText('Không có dữ liệu để hiển thị (tệp trống, quá lớn hoặc không phải văn bản).')).toBeInTheDocument()
    second.unmount()
    buffer.text = null
    open('data.csv', { loadError: 'Không đọc được tệp' })
    expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được tệp')
  })

  it('nút Mã nguồn quay lại trình soạn thảo', () => {
    buffer.text = 'a\n1'
    const onViewSource = vi.fn()
    open('data.csv', { onViewSource })
    fireEvent.click(screen.getByRole('button', { name: 'Xem mã nguồn' }))
    expect(onViewSource).toHaveBeenCalledOnce()
  })
})

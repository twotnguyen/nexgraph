// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitBlameLine, NexGraphApi } from '@nexgraph/contracts/api'
import { installNexgraph } from '../../test-utils'
import { setBlame, setEditorPrefs } from '../../shared/lib/editorPrefs'

const note = vi.hoisted(() => vi.fn<(line: number, text: string | null) => void>())
const cursor = vi.hoisted(() => ({ move: (_line: number) => {} }))
vi.mock('./monaco', () => ({
  languageFor: () => 'typescript',
  createEditor: (host: HTMLElement, opts: { value: string }) => {
    const textarea = document.createElement('textarea')
    textarea.value = opts.value
    host.appendChild(textarea)
    return {
      getValue: () => textarea.value, setValue: (value: string) => { textarea.value = value }, setReadOnly: () => {},
      onChange: () => {}, revealLines: () => {}, setLineNote: note,
      onCursor: (callback: (line: number, column: number) => void) => { cursor.move = (line) => callback(line, 1) },
      dispose: () => textarea.remove()
    }
  }
}))

import { EditorTab, blameText } from './EditorTab'

const day = 86_400
const NOW = Date.parse('2026-11-21T00:00:00Z')
const line = (n: number, author: string, summary: string): GitBlameLine => ({ line: n, sha: `s${n}`, author, time: NOW / 1000 - 3 * day, summary, uncommitted: false })
const AN = 'An, 3 ngày trước • Sửa lỗi'
const BINH = 'Bình, 3 ngày trước • Thêm test'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  note.mockClear()
  setBlame(true)
  setEditorPrefs({ blameDelay: 0, blameSummary: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setBlame(false)
  setEditorPrefs({ blameDelay: 0, blameSummary: true })
})

// Cho chuỗi đọc tệp → nạp blame → vẽ chú thích chạy hết mà không cần đồng hồ thật.
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

async function open() {
  const blame = vi.fn(async () => [line(1, 'An', 'Sửa lỗi'), line(2, 'Bình', 'Thêm test')])
  installNexgraph({ fs: { read: vi.fn(async () => ({ text: 'a\nb', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'v1', readOnly: false })) } })
  ;(window.nexgraph as NexGraphApi).git = { blame } as unknown as NonNullable<NexGraphApi['git']>
  render(<EditorTab projectId="p1" file="main.ts" line={1} onClose={() => {}} onDirtyChange={() => {}} />)
  await settle()
  return blame
}

describe('inline blame', () => {
  it('blameText bỏ phần tóm tắt khi tắt', () => {
    expect(blameText(line(1, 'An', 'Sửa lỗi'), NOW)).toBe(AN)
    expect(blameText(line(1, 'An', 'Sửa lỗi'), NOW, false)).toBe('An, 3 ngày trước')
    expect(blameText({ ...line(1, 'An', 'Sửa lỗi'), uncommitted: true }, NOW, false)).toBe('Bạn • Chưa commit')
  })

  it('độ trễ 0: hiện ngay ở dòng có con trỏ và đổi theo dòng', async () => {
    const blame = await open()
    expect(blame).toHaveBeenCalledWith('p1', 'main.ts')
    expect(note).toHaveBeenLastCalledWith(1, AN)
    act(() => cursor.move(2))
    expect(note).toHaveBeenLastCalledWith(2, BINH)
  })

  it('tắt tóm tắt thì chỉ còn tác giả và thời điểm', async () => {
    setEditorPrefs({ blameSummary: false })
    await open()
    expect(note).toHaveBeenLastCalledWith(1, 'An, 3 ngày trước')
    act(() => setEditorPrefs({ blameSummary: true }))
    expect(note).toHaveBeenLastCalledWith(1, AN)
  })

  it('có độ trễ: chú thích cũ biến mất ngay, mới hiện sau khi con trỏ đứng yên đủ lâu và đổi dòng thì tính lại từ đầu', async () => {
    setEditorPrefs({ blameDelay: 500 })
    await open()
    expect(note).toHaveBeenLastCalledWith(1, null)
    await advance(499)
    expect(note).not.toHaveBeenCalledWith(1, AN)
    await advance(1)
    expect(note).toHaveBeenLastCalledWith(1, AN)

    act(() => cursor.move(2))
    expect(note).toHaveBeenLastCalledWith(2, null)
    await advance(300)
    act(() => cursor.move(1)) // đổi dòng giữa chừng: bộ đếm của dòng 2 phải bị huỷ
    await advance(300)
    expect(note).not.toHaveBeenCalledWith(2, BINH)
    expect(note).toHaveBeenLastCalledWith(1, null)
    await advance(200)
    expect(note).toHaveBeenLastCalledWith(1, AN)
  })
})

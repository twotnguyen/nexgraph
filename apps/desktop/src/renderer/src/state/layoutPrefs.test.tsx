// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getExplorerOpen, setChatDock, setChatWidth, setExplorerOpen, setStatusBar, setTerminalHeight,
  useChatDock, useChatWidth, useExplorerOpen, useStatusBar, useTerminalHeight
} from './layoutPrefs'

function Probe() {
  return <p>{[useChatDock(), useChatWidth(), useTerminalHeight(), useExplorerOpen(), useStatusBar()].join('|')}</p>
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('tuỳ chọn bố cục', () => {
  it('đọc giá trị thiếu hoặc hỏng về mặc định', () => {
    localStorage.setItem('nexgraph.chat.dock', 'middle')
    localStorage.setItem('nexgraph.chat.width', 'abc')
    localStorage.setItem('nexgraph.terminal.height', ' ')
    render(<Probe />)
    expect(screen.getByText('left|360|280|true|true')).toBeInTheDocument()
  })

  it('giới hạn và làm tròn số khi ghi; số 0 vẫn là số chứ không rơi về mặc định', () => {
    const changed = vi.fn()
    window.addEventListener('nexgraph:layout-prefs', changed)
    const stored = (key: string) => localStorage.getItem(key)
    setChatWidth(10)
    expect(stored('nexgraph.chat.width')).toBe('300')
    setChatWidth(0)
    expect(stored('nexgraph.chat.width')).toBe('300')
    setChatWidth(9999)
    expect(stored('nexgraph.chat.width')).toBe('640')
    setChatWidth(400.6)
    expect(stored('nexgraph.chat.width')).toBe('401')
    setChatWidth(Number.NaN)
    expect(stored('nexgraph.chat.width')).toBe('360')
    setTerminalHeight(50)
    expect(stored('nexgraph.terminal.height')).toBe('120')
    setTerminalHeight(99999)
    expect(stored('nexgraph.terminal.height')).toBe('2000')
    expect(changed).toHaveBeenCalledTimes(7)
    window.removeEventListener('nexgraph:layout-prefs', changed)
  })

  it('ghi bật/tắt và vị trí khung chat, giá trị lạ về mặc định', () => {
    setExplorerOpen(false)
    expect(localStorage.getItem('nexgraph.layout.explorer')).toBe('0')
    expect(getExplorerOpen()).toBe(false)
    setExplorerOpen(true)
    expect(getExplorerOpen()).toBe(true)
    setChatDock('right')
    expect(localStorage.getItem('nexgraph.chat.dock')).toBe('right')
    setChatDock('middle' as never)
    expect(localStorage.getItem('nexgraph.chat.dock')).toBe('left')
  })

  it('component đang mở vẽ lại ngay khi ghi từ nơi khác', () => {
    render(<Probe />)
    act(() => {
      setChatDock('right')
      setChatWidth(500)
      setTerminalHeight(400)
      setExplorerOpen(false)
      setStatusBar(false)
    })
    expect(screen.getByText('right|500|400|false|false')).toBeInTheDocument()
  })
})

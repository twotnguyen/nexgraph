// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_NAME, MAX_SAVED, MAX_TEXT, parseSavedPrompts, suggestName, upsertPrompt, type SavedPrompt } from './savedPromptsStore'

const KEY = 'nexgraph.agent.savedPrompts'
/** Mô phỏng khởi động lại: nạp lại module để nó đọc localStorage từ đầu. */
const restart = async () => { vi.resetModules(); return await import('./savedPromptsStore') }
const listOf = (store: Awaited<ReturnType<typeof restart>>): SavedPrompt[] => renderHook(() => store.useSavedPrompts()).result.current
const item = (id: string, name = id, text = `nội dung ${id}`): SavedPrompt => ({ id, name, text, savedAt: 1 })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('đọc kho tin đã lưu', () => {
  it('dữ liệu hỏng thì bỏ phần hỏng, giữ phần còn dùng được', () => {
    expect(parseSavedPrompts(null)).toEqual([])
    expect(parseSavedPrompts('{hỏng')).toEqual([])
    expect(parseSavedPrompts('{"id":"a"}')).toEqual([])
    const good = item('tốt')
    const raw = JSON.stringify([good, null, 7, { ...item('a'), name: '   ' }, { ...item('b'), text: '' }, { ...item('c'), name: 'x'.repeat(MAX_NAME + 1) },
      { ...item('d'), text: 'x'.repeat(MAX_TEXT + 1) }, { ...item('e'), savedAt: 'hôm qua' }, { ...item(''), name: 'không id' }, item('tốt', 'trùng id')])
    expect(parseSavedPrompts(raw)).toEqual([good])
  })

  it('không đọc quá giới hạn số tin', () => {
    const many = Array.from({ length: MAX_SAVED + 5 }, (_, index) => item(String(index)))
    expect(parseSavedPrompts(JSON.stringify(many))).toHaveLength(MAX_SAVED)
  })
})

describe('tên gợi ý và ghi đè theo tên', () => {
  it('tên gợi ý là dòng đầu có chữ, gọn khoảng trắng, cắt có dấu …', () => {
    expect(suggestName('\n\n  Xem   lại\tdiff  \nchi tiết')).toBe('Xem lại diff')
    expect(suggestName('')).toBe('')
    const long = suggestName('a'.repeat(100))
    expect(long).toHaveLength(40)
    expect(long.endsWith('…')).toBe(true)
  })

  it('trùng tên (không phân biệt hoa thường) thì thay nội dung, giữ id và đưa lên đầu', () => {
    const list = [item('1', 'Review'), item('2', 'Giải thích')]
    const next = upsertPrompt(list, 'giải THÍCH', 'bản mới', 5, 'id-mới')
    expect(next).toEqual([{ id: '2', name: 'giải THÍCH', text: 'bản mới', savedAt: 5 }, list[0]])
    expect(upsertPrompt(list, 'Khác', 'x', 5, 'id-mới')[0]).toMatchObject({ id: 'id-mới', name: 'Khác' })
  })
})

describe('lưu và xóa', () => {
  it('tin đã lưu còn sau khi khởi động lại; xóa cũng còn hiệu lực sau khi khởi động lại', async () => {
    const first = await restart()
    expect(first.savePrompt('Review', 'Hãy xem lại diff này')).toBeNull()
    expect(first.savePrompt('Test', 'Viết test cho hàm vừa sửa')).toBeNull()
    const reopened = listOf(await restart())
    expect(reopened.map(({ name, text }) => ({ name, text }))).toEqual([
      { name: 'Test', text: 'Viết test cho hàm vừa sửa' },
      { name: 'Review', text: 'Hãy xem lại diff này' }
    ])
    const second = await restart()
    second.deletePrompt(reopened[0].id)
    expect(listOf(await restart()).map((prompt) => prompt.name)).toEqual(['Review'])
  })

  it('component đang hiện thấy thay đổi ngay, không cần tải lại', async () => {
    const store = await restart()
    const { result } = renderHook(() => store.useSavedPrompts())
    expect(result.current).toEqual([])
    act(() => { store.savePrompt('A', 'một') })
    expect(result.current.map((prompt) => prompt.name)).toEqual(['A'])
    act(() => store.deletePrompt(result.current[0].id))
    expect(result.current).toEqual([])
  })

  it('từ chối tin trống hoặc quá dài, không ghi gì', async () => {
    const store = await restart()
    expect(store.savePrompt('x', '  \n ')).toMatch(/trống/)
    expect(store.savePrompt('x', 'a'.repeat(MAX_TEXT + 1))).toMatch(/dài/)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('tên trống lấy tên gợi ý; tên dài bị cắt; trùng tên ghi đè chứ không nhân đôi', async () => {
    const store = await restart()
    store.savePrompt('   ', 'Sửa lỗi đăng nhập\nchi tiết thêm')
    store.savePrompt('n'.repeat(MAX_NAME + 20), 'dài')
    store.savePrompt('sửa lỗi đăng nhập', 'bản thứ hai')
    const names = listOf(await restart()).map((prompt) => [prompt.name, prompt.text])
    expect(names).toEqual([['sửa lỗi đăng nhập', 'bản thứ hai'], ['n'.repeat(MAX_NAME), 'dài']])
  })

  it('đủ số tin tối đa thì không thêm tin mới nhưng vẫn sửa được tin cùng tên', async () => {
    const store = await restart()
    for (let index = 0; index < MAX_SAVED; index++) expect(store.savePrompt(`tin ${index}`, `nội dung ${index}`)).toBeNull()
    expect(store.savePrompt('một tin nữa', 'x')).toMatch(/tối đa/)
    expect(store.savePrompt('tin 3', 'đã sửa')).toBeNull()
    const saved = listOf(await restart())
    expect(saved).toHaveLength(MAX_SAVED)
    expect(saved.find((prompt) => prompt.name === 'tin 3')?.text).toBe('đã sửa')
    expect(saved.some((prompt) => prompt.name === 'một tin nữa')).toBe(false)
  })

  it('ghi bộ nhớ thất bại thì báo lỗi và danh sách đang hiện không nói dối là đã lưu', async () => {
    const store = await restart()
    store.savePrompt('Giữ', 'tin còn lại')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('đầy', 'QuotaExceededError') })
    expect(store.savePrompt('Mới', 'không lưu được')).toMatch(/bộ nhớ/)
    const { result } = renderHook(() => store.useSavedPrompts())
    expect(result.current.map((prompt) => prompt.name)).toEqual(['Giữ'])
    store.deletePrompt(result.current[0].id)
    expect(result.current.map((prompt) => prompt.name)).toEqual(['Giữ'])
  })
})

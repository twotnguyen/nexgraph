import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IndexOptionsStore } from '../src/main/index-options'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ng-index-options-'))
  file = join(dir, 'index-options.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('IndexOptionsStore', () => {
  it('Index lại không gửi lựa chọn thì dùng bản đã nhớ theo dự án (A3 #7)', () => {
    const store = new IndexOptionsStore(file)
    expect(store.resolve('p1', { exclude: ['dist/'], includeDocs: true, includeMedia: false, includeConfig: true, force: true, workers: 2 }))
      .toEqual({ exclude: ['dist/'], includeDocs: true, includeMedia: false, includeConfig: true, force: true, workers: 2 })
    // Nút "Index lại" gửi {}: lựa chọn dính lấy từ bản nhớ, force là của một lần chạy nên không dính.
    expect(store.resolve('p1', {})).toEqual({ exclude: ['dist/'], includeDocs: true, includeMedia: false, includeConfig: true, workers: 2 })
    // Hộp thoại gửi tường minh thì thắng bản nhớ và trở thành bản nhớ mới.
    expect(store.resolve('p1', { includeDocs: false, includeMedia: false }))
      .toEqual({ exclude: ['dist/'], includeDocs: false, includeMedia: false, includeConfig: true, workers: 2 })
    expect(new IndexOptionsStore(file).remembered('p1')).toEqual({ exclude: ['dist/'], includeDocs: false, includeMedia: false, includeConfig: true, workers: 2 })
  })

  it('không dính sang dự án khác và xoá được khi gỡ dự án', () => {
    const store = new IndexOptionsStore(file)
    store.resolve('p1', { includeDocs: true })
    expect(store.resolve('p2', {})).toEqual({})
    expect(store.remembered('p2')).toBeNull()
    store.forget('p1')
    expect(store.remembered('p1')).toBeNull()
  })

  it('bỏ trống lựa chọn một lần không xoá bản nhớ (chỉ ghi khoá được gửi)', () => {
    const store = new IndexOptionsStore(file)
    store.resolve('p1', { includeDocs: true, includeConfig: true, workers: 4 })
    expect(store.resolve('p1', { workers: undefined, force: false }))
      .toEqual({ includeDocs: true, includeConfig: true, workers: 4, force: false })
  })
})

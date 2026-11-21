import { describe, expect, it } from 'vitest'
import { applyProjectEdits, applyTextEdits, diagnosticMarker, type ProjectEditAdapter } from './lspEdits'
import type { FileContent } from '@shared/api'

const range = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })

describe('LSP diagnostics', () => {
  it('đổi vị trí 0-based và mức độ thành marker của Monaco', () => {
    expect(diagnosticMarker({ range: range(0, 3, 1, 2), severity: 1, message: 'Sai kiểu', source: 'ts', code: 123 })).toEqual({
      startLineNumber: 1, startColumn: 4, endLineNumber: 2, endColumn: 3,
      severity: 8, message: 'Sai kiểu', source: 'ts', code: '123', tags: undefined
    })
    expect(diagnosticMarker({ range: range(1, 0, 1, 1), severity: 2, message: 'Cảnh báo' }).severity).toBe(4)
    expect(diagnosticMarker({ range: range(1, 0, 1, 1), severity: 3, message: 'Thông tin' }).severity).toBe(2)
    expect(diagnosticMarker({ range: range(1, 0, 1, 1), severity: 4, message: 'Gợi ý', tags: [1, 2] }).tags).toEqual([1, 2])
    expect(diagnosticMarker({ range: range(1, 0, 1, 1), message: 'Lỗi' }).severity).toBe(8)
  })
})

describe('áp dụng text edits của language server', () => {
  it('giữ đúng thứ tự các edit theo UTF-16 kể cả khi khác dòng', () => {
    const text = 'const 😀name = 1\nname()\n'
    expect(applyTextEdits(text, [
      { range: range(1, 0, 1, 4), newText: 'title' },
      { range: range(0, 8, 0, 12), newText: 'title' }
    ])).toBe('const 😀title = 1\ntitle()\n')
  })
  it('giữ thứ tự các phép chèn cùng vị trí', () => {
    expect(applyTextEdits('ab', [
      { range: range(0, 1, 0, 1), newText: 'X' }, { range: range(0, 1, 0, 1), newText: 'Y' }
    ])).toBe('aXYb')
  })
  it('từ chối vùng sai hoặc chồng lấn để không phá nội dung', () => {
    expect(() => applyTextEdits('abc', [{ range: range(0, 0, 0, 4), newText: '' }])).toThrow()
    expect(() => applyTextEdits('abc', [{ range: range(0, 0, 0, 2), newText: '' }, { range: range(0, 1, 0, 3), newText: '' }])).toThrow()
  })
})

describe('WorkspaceEdit', () => {
  type Buffer = { text: string; version: number; disposed: boolean }
  const diskFile = (text: string, version = '1'): FileContent => ({ text, version, mtimeMs: 0, eol: '\n', bom: false, readOnly: false })
  const replace = [{ range: range(0, 0, 0, 3), newText: 'new' }]

  function fixture(failFile?: string) {
    const buffer: Buffer = { text: 'old open', version: 1, disposed: false }
    const disk = new Map([['closed.ts', diskFile('old closed')], ['other.ts', diskFile('old other')]])
    const adapter: ProjectEditAdapter<Buffer> = {
      findModel: (file) => file === 'open.ts' ? buffer : null,
      isReadOnly: () => false,
      text: (model) => model.text,
      version: (model) => model.version,
      disposed: (model) => model.disposed,
      apply: (model, edits) => { model.text = applyTextEdits(model.text, edits); model.version++ },
      read: async (file) => { const found = disk.get(file); if (!found) throw new Error('missing'); return { ...found } },
      write: async (file, text, opts) => {
        const found = disk.get(file)
        if (!found || opts.expectedVersion !== found.version || file === failFile) throw new Error('conflict')
        const version = String(Number(found.version) + 1)
        disk.set(file, { ...found, text, version })
        return { version, mtimeMs: 0 }
      }
    }
    return { buffer, disk, adapter }
  }

  it('cập nhật buffer đang mở và ghi tệp chưa mở', async () => {
    const { buffer, disk, adapter } = fixture()
    await applyProjectEdits({ 'open.ts': replace, 'closed.ts': replace }, adapter)
    expect(buffer.text).toBe('new open')
    expect(disk.get('closed.ts')?.text).toBe('new closed')
  })

  it('hoàn tác tệp đã ghi và giữ buffer nếu ghi tệp khác thất bại', async () => {
    const { buffer, disk, adapter } = fixture('other.ts')
    await expect(applyProjectEdits({ 'open.ts': replace, 'closed.ts': replace, 'other.ts': replace }, adapter)).rejects.toThrow('conflict')
    expect(buffer.text).toBe('old open')
    expect(disk.get('closed.ts')?.text).toBe('old closed')
  })
})

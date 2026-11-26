import type { FileContent, FileRevision, LspDiagnostic, LspTextEdit, LspWorkspaceEdit, WriteOpts } from '@nexgraph/contracts/api'
import { tr } from '../../strings'

/** Phạm vi LSP tính từ 0; marker và editor Monaco tính từ 1. */
export function diagnosticMarker(diagnostic: LspDiagnostic) {
  const { start, end } = diagnostic.range
  return {
    startLineNumber: start.line + 1, startColumn: start.character + 1,
    endLineNumber: end.line + 1, endColumn: end.character + 1,
    severity: diagnostic.severity === 2 ? 4 : diagnostic.severity === 3 ? 2 : diagnostic.severity === 4 ? 1 : 8,
    message: diagnostic.message, source: diagnostic.source,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    tags: diagnostic.tags?.filter((tag) => tag === 1 || tag === 2)
  }
}

/** Áp dụng cùng lúc các khoảng UTF-16 của LSP, từ cuối tài liệu về đầu. */
export function applyTextEdits(text: string, edits: readonly LspTextEdit[]): string {
  const lines = text.split('\n')
  const starts: number[] = []
  let at = 0
  for (const line of lines) { starts.push(at); at += line.length + 1 }
  const offset = ({ line, character }: LspTextEdit['range']['start']) => {
    if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || line >= lines.length || character < 0 || character > lines[line].length) {
      throw new Error(tr('Phạm vi chỉnh sửa của language server không hợp lệ'))
    }
    return starts[line] + character
  }
  const changes = edits.map((edit, index) => ({ start: offset(edit.range.start), end: offset(edit.range.end), text: edit.newText, index }))
  changes.sort((a, b) => b.start - a.start || b.index - a.index)
  let previous = text.length
  for (const edit of changes) {
    if (typeof edit.text !== 'string' || edit.end < edit.start || edit.end > previous) throw new Error(tr('Các vùng chỉnh sửa của language server chồng lấn hoặc không hợp lệ'))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
    previous = edit.start
  }
  return text
}

export interface ProjectEditAdapter<Model> {
  findModel(file: string): Model | null
  isReadOnly(model: Model): boolean
  text(model: Model): string
  version(model: Model): number
  disposed(model: Model): boolean
  apply(model: Model, edits: LspTextEdit[]): void
  read(file: string): Promise<FileContent>
  write(file: string, text: string, opts: WriteOpts & { expectedVersion: string }): Promise<FileRevision>
}

/** Không ghi đè thay đổi đồng thời; hoàn tác các lần ghi trước khi một tệp báo lỗi. */
export async function applyProjectEdits<Model>(edits: LspWorkspaceEdit, adapter: ProjectEditAdapter<Model>): Promise<void> {
  const open: { file: string; model: Model; version: number; edits: LspTextEdit[] }[] = []
  const closed: { file: string; before: FileContent; text: string }[] = []
  for (const [file, changes] of Object.entries(edits)) {
    const model = adapter.findModel(file)
    if (model) {
      if (adapter.isReadOnly(model)) throw new Error(tr('Tệp chỉ đọc: {file}', { file }))
      applyTextEdits(adapter.text(model), changes)
      open.push({ file, model, version: adapter.version(model), edits: changes })
    } else {
      const before = await adapter.read(file)
      if (before.readOnly) throw new Error(tr('Tệp chỉ đọc: {file}', { file }))
      closed.push({ file, before, text: applyTextEdits(before.text, changes) })
    }
  }
  const checkOpen = () => {
    if (open.some(({ file, model, version }) => adapter.findModel(file) !== model || adapter.disposed(model) || adapter.version(model) !== version) ||
        closed.some(({ file }) => adapter.findModel(file) !== null)) {
      throw new Error(tr('Tệp đang mở đã thay đổi; hãy thử lại'))
    }
  }
  const written: { file: string; before: FileContent; version: string }[] = []
  try {
    checkOpen()
    for (const { file, before, text } of closed) {
      const revision = await adapter.write(file, text, { eol: before.eol, bom: before.bom, expectedVersion: before.version })
      written.push({ file, before, version: revision.version })
    }
    checkOpen()
  } catch (error) {
    let rollbackFailed = false
    for (const { file, before, version } of written.reverse()) {
      try { await adapter.write(file, before.text, { eol: before.eol, bom: before.bom, expectedVersion: version }) }
      catch { rollbackFailed = true }
    }
    if (rollbackFailed) throw new Error(tr('Không hoàn tác được mọi tệp đã ghi; hãy kiểm tra thay đổi trên đĩa'))
    throw error
  }
  for (const { model, edits: changes } of open) adapter.apply(model, changes)
}

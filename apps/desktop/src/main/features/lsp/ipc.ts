import type { LspCallHierarchyItem, LspRange } from '@nexgraph/contracts/api'
import { FsError } from '../../platform/project-fs'
import { LspManager } from './manager'
import type { IpcContext } from '../../platform/ipc-context'

/** Language server cho editor; khởi động khi mở tệp TS/JS/Python đầu tiên. */
const lsp = new LspManager()
const lspProjects = new Map<string, string>()

/** Dừng mọi language server khi thoát app. */
export const stopLanguageServers = (): void => {
  lsp.stopAll()
  lspProjects.clear()
}

/** Language server cho editor: tệp phải nằm trong dự án (resolveInside), dòng/cột từ Monaco (tính từ 1) đổi sang LSP (từ 0). */
export function registerLspIpc(ctx: IpcContext): void {
  const { on, rootOf, getWindow } = ctx
  ctx.onProjectRemove((pid) => {
    const root = lspProjects.get(pid)
    if (root) lsp.stop(root)
    lspProjects.delete(pid)
  })
  lsp.onDiagnostics = (root, file, diagnostics) => {
    for (const [pid, projectRootPath] of lspProjects) {
      if (projectRootPath === root) getWindow()?.webContents.send('lsp:diagnostics', { projectId: pid, file, diagnostics })
    }
  }
  const lspFor = async (pid: string): Promise<string> => {
    const root = await rootOf(pid)
    const expected = lspProjects.get(pid)
    if (expected && expected !== root) {
      lsp.stop(expected)
      lspProjects.delete(pid)
    }
    lspProjects.set(pid, root)
    return root
  }
  const lspArgs = (text: unknown, line: unknown, column: unknown): [string, number, number] => {
    if (typeof text !== 'string' || !Number.isInteger(line) || !Number.isInteger(column) ||
      Number(line) < 1 || Number(column) < 1) throw new FsError('bad_param', 'Tham số language server không hợp lệ')
    return [text, Number(line) - 1, Number(column) - 1]
  }
  const lspPos = (text: unknown, line: unknown, column: unknown): [number, number] => {
    const [, lineIndex, character] = lspArgs(text, line, column)
    return [lineIndex, character]
  }
  const lspRequest = <A extends unknown[], R>(method: (root: string, ...args: A) => Promise<R>) =>
    async (pid: string, ...args: A): Promise<R> => method(await lspFor(pid), ...args)
  on('lsp:definition', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.definition(root, file, text, ...lspPos(text, line, column))))
  on('lsp:declaration', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.declaration(root, file, text, ...lspPos(text, line, column))))
  on('lsp:type-definition', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.typeDefinition(root, file, text, ...lspPos(text, line, column))))
  on('lsp:completion', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.completion(root, file, text, ...lspPos(text, line, column))))
  on('lsp:hover', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.hover(root, file, text, ...lspPos(text, line, column))))
  on('lsp:references', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.references(root, file, text, ...lspPos(text, line, column))))
  on('lsp:implementation', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.implementation(root, file, text, ...lspPos(text, line, column))))
  on('lsp:rename', lspRequest((root, file: string, text: string, line: number, column: number, newName: string) => {
    if (typeof newName !== 'string' || !newName) throw new FsError('bad_param', 'Tên mới không hợp lệ')
    return lsp.rename(root, file, text, ...lspPos(text, line, column), newName)
  }))
  on('lsp:format', lspRequest((root, file: string, text: string, options: { tabSize: number; insertSpaces: boolean }) => {
    if (!options || !Number.isInteger(options.tabSize) || options.tabSize < 1 || options.tabSize > 16 || typeof options.insertSpaces !== 'boolean')
      throw new FsError('bad_param', 'Tuỳ chọn định dạng không hợp lệ')
    return lsp.format(root, file, text, options)
  }))
  on('lsp:document-symbols', lspRequest((root, file: string, text: string) => lsp.documentSymbols(root, file, lspArgs(text, 1, 1)[0])))
  on('lsp:call-hierarchy-prepare', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.callHierarchyPrepare(root, file, text, ...lspPos(text, line, column))))
  on('lsp:call-hierarchy-incoming', lspRequest((root, file: string, text: string, line: number, column: number, item: LspCallHierarchyItem) =>
    lsp.callHierarchyIncoming(root, file, text, ...lspPos(text, line, column), item)))
  on('lsp:call-hierarchy-outgoing', lspRequest((root, file: string, text: string, line: number, column: number, item: LspCallHierarchyItem) =>
    lsp.callHierarchyOutgoing(root, file, text, ...lspPos(text, line, column), item)))
  on('lsp:workspace-symbols', lspRequest((root, query: string) => {
    if (typeof query !== 'string') throw new FsError('bad_param', 'Truy vấn không hợp lệ')
    return lsp.workspaceSymbols(root, query)
  }))
  on('lsp:signature-help', lspRequest((root, file: string, text: string, line: number, column: number) =>
    lsp.signatureHelp(root, file, text, ...lspPos(text, line, column))))
  on('lsp:code-actions', lspRequest((root, file: string, text: string, range: LspRange) => {
    if (!range || typeof range !== 'object') throw new FsError('bad_param', 'Phạm vi không hợp lệ')
    return lsp.codeActions(root, file, text, range)
  }))
  on('lsp:close', lspRequest((root, file: string) => { lsp.close(root, file); return Promise.resolve() }))
  on('lsp:open', lspRequest((root, file: string, text: string) => lsp.open(root, file, lspArgs(text, 1, 1)[0])))
}

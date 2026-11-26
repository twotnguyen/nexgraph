import { shell } from 'electron'
import type { TextSearchQuery, WriteOpts } from '../../../shared/api'
import { AgentFileScope } from '../../agent/file-scope'
import { FsError, fsHandlers, isProtectedRel, readProjectFileBytes } from '../../fs/project-fs'
import { projectOperations } from '../../fs/project-operations'
import type { IpcContext } from '../../platform/ipc-context'
import { GENERATED_DIRS, replaceText, searchText } from '../../search/text-search'

/** Cây tệp, đọc/ghi, thao tác tệp, tìm tệp (⌘P) và tìm/thay văn bản trong dự án. */
export function registerFilesIpc(ctx: IpcContext): void {
  const { on, listProjects, rootOf } = ctx
  const fsh = fsHandlers(listProjects)
  on('fs:list', fsh.list)
  on('fs:read', fsh.read)
  const fsOps = projectOperations(listProjects, shell)
  on('fs:create-file', fsOps.createFile)
  on('fs:create-dir', fsOps.createDir)
  on('fs:rename', fsOps.rename)
  on('fs:copy', fsOps.copy)
  on('fs:trash', fsOps.trash)
  on('fs:reveal', fsOps.reveal)
  on('fs:read-binary', async (pid: string, relPath: string) => {
    const bytes = readProjectFileBytes(await rootOf(pid), relPath, 50 * 1024 * 1024)
    return { data: bytes.toString('base64'), size: bytes.length }
  })
  // Tìm tệp (⌘P): mọi tệp theo .gitignore, bỏ thư mục sinh ra và tệp được bảo vệ; tối đa 20.000 mục duyệt.
  on('fs:files', async (pid: string) => {
    const scope = new AgentFileScope(await rootOf(pid), GENERATED_DIRS)
    const state = { limited: false }
    const files: string[] = []
    for await (const entry of scope.entries(scope.entry('.'), true, state)) {
      if (!entry.directory && !isProtectedRel(entry.relative)) files.push(entry.relative)
    }
    return { files, truncated: state.limited }
  })
  on('fs:search-text', async (pid: string, query: TextSearchQuery) => searchText(await rootOf(pid), query))
  on('fs:replace-text', async (pid: string, query: TextSearchQuery, replacement: string, files: string[]) =>
    replaceText(await rootOf(pid), query, String(replacement ?? ''), Array.isArray(files) ? files.filter((f) => typeof f === 'string') : []))
  on('fs:write', async (pid: string, relPath: string, text: string, opts: WriteOpts) => {
    const version = opts?.expectedVersion
    if (version !== null && (typeof version !== 'string' || !version)) {
      throw new FsError('conflict', 'Cần đọc lại tệp trước khi lưu')
    }
    return fsh.write(pid, relPath, text, opts)
  })
}

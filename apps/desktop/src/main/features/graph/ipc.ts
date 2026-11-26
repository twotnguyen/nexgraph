import { app, dialog } from 'electron'
import type { AnswerRating, FlowQuery, MemoryKind, NeighborQuery } from '@nexgraph/contracts/graph-types'
import type { IpcContext } from '../../platform/ipc-context'

/** Truy vấn đồ thị qua engine, cùng nguồn ngoài (W6), bộ nhớ làm việc (W10), graph chung (W8) và pull request (W7). */
export function registerGraphIpc(ctx: IpcContext): void {
  const { on, api, getWindow } = ctx
  on('graph:stats', (pid: string) => api().stats(pid))
  on('graph:neighbors', (pid: string, q: NeighborQuery) => api().neighbors(pid, q))
  on('graph:node', (pid: string, id: string) => api().getNode(pid, id))
  on('graph:code', (pid: string, file: string, start?: number, end?: number) => api().code(pid, file, start, end))
  on('graph:search', (pid: string, q: string, opts?: { kinds?: string[]; limit?: number }) => api().search(pid, q, opts))
  on('graph:architecture', (pid: string, parent?: string) => api().architecture(pid, parent))
  on('graph:arch-evidence', (pid: string, from: string, to: string, limit?: number) => api().archEvidence(pid, from, to, limit))
  on('engine:tools', () => api().tools())
  on('graph:report', (pid: string, lang?: 'vi' | 'en') => api().report(pid, lang))
  on('graph:explain', (pid: string, nodeId: string) => api().explain(pid, nodeId))
  on('graph:section', (pid: string, nodeId: string) => api().section(pid, nodeId))
  on('graph:paths', (pid: string, ids: string[], o?: { maxHops?: number; directed?: boolean }) => api().paths(pid, ids, o))
  on('graph:impact-of', (pid: string, nodeId: string) => api().impactOf(pid, nodeId))
  on('graph:ask', (pid: string, q: string, o?: { depth?: number; budget?: number; mode?: 'bfs' | 'dfs' }) => api().ask(pid, q, o))
  on('graph:recluster', (pid: string) => api().recluster(pid))
  on('graph:flows', (pid: string, opts?: FlowQuery) => api().flows(pid, opts))
  on('graph:flow', (pid: string, flowId: number) => api().flow(pid, flowId))
  on('graph:tour', (pid: string, lang?: 'vi' | 'en') => api().tour(pid, lang))
  on('graph:locate', (pid: string, file: string, line: number) => api().locate(pid, file, line))
  on('graph:context', (pid: string, q: string, budget?: number) => api().context(pid, q, budget))
  on('graph:map', (pid: string, o?: { parent?: string; detail?: number }) => api().map(pid, o))
  on('graph:cycles', (pid: string, limit?: number) => api().cycles(pid, limit))

  // Nguồn ngoài thư mục (W6): engine kiểm URL (chỉ GitHub/GitLab khi clone; guard SSRF khi tải).
  on('sources:clone', async (url: string) => ({ jobId: (await api().cloneProject(url)).job_id }))
  on('sources:list', (pid: string) => api().listSources(pid))
  on('sources:add', async (pid: string, url: string) => ({ jobId: (await api().addSource(pid, url)).job_id }))
  on('sources:remove', (pid: string, name: string) => api().removeSource(pid, name))

  // Bộ nhớ làm việc (W10): mọi ghi đi qua engine, engine giữ khoá ghi của dự án.
  on('memory:recall', (pid: string, q: { node?: string; q?: string }) => api().recallMemory(pid, q))
  on('memory:add', (pid: string, kind: MemoryKind, text: string, nodeIds: string[]) => api().addMemory(pid, kind, text, nodeIds))
  on('memory:rate', (pid: string, rating: AnswerRating) => api().rateAnswer(pid, rating))
  on('memory:lessons', (pid: string) => api().lessons(pid))
  // Graph chung nhiều repo (W8): thư mục xuất chọn ở main, renderer không gửi path.
  on('global:list', () => api().globalList())
  on('global:add', async (pid: string) => ({ jobId: (await api().globalAdd(pid)).job_id }))
  on('global:remove', (pid: string) => api().globalRemove(pid))
  on('global:search', (q: string, limit?: number, pids?: string[]) => api().globalSearch(q, limit, pids))
  on('global:graph', (pids: string[], limit?: number) => api().globalGraph(pids, limit))
  on('global:export', async (pids: string[]) => {
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Chọn thư mục lưu graph.json gộp',
      defaultPath: app.getPath('downloads')
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return api().globalExport(pids, r.filePaths[0])
  })
  // Pull request (W7): engine gọi `gh` chỉ đọc; số PR được engine kiểm lại.
  on('prs:status', (pid: string) => api().prStatus(pid))
  on('prs:list', (pid: string) => api().listPrs(pid))
  on('prs:detail', (pid: string, n: number) => api().prDetail(pid, n))
}

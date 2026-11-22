import { createElement as h, Fragment, type ComponentProps, type ReactNode } from 'react'
import type { NodeImpact } from '@shared/graph-types'
import { ChangesPanel } from '../components/changes/ChangesPanel'
import { DebugPanel } from '../components/debug/DebugPanel'
import { DiagnosticsPanel, OutlinePanel } from '../components/editor/EditorPanels'
import { GitPanel } from '../components/git/GitPanel'
import { SearchPanel } from '../components/search/SearchPanel'
import { ProjectSearch } from '../components/search/ProjectSearch'
import { TourPanel } from '../components/tour/TourPanel'
import { TreeView } from '../components/tree/TreeView'
import { Icon } from '../components/common/icons'
import { tr, vi } from '../strings'

type TreeProps = ComponentProps<typeof TreeView>
type OutlineProps = ComponentProps<typeof OutlinePanel>
type SearchProps = ComponentProps<typeof SearchPanel>
type ChangesProps = ComponentProps<typeof ChangesPanel>

/** Dữ liệu và callback mà thân mỗi bảng cần; WorkspaceScreen tạo một lần rồi đưa cho registry. */
export interface WorkbenchPanelContext {
  projectId: string
  projectName: string
  projectPath: string
  revision: number
  activeFile?: string
  previewFile?: string
  dirtyFiles: ReadonlySet<string>
  findFocus: number
  editor: OutlineProps['editor']
  symbols: OutlineProps['symbols']
  symbolError: OutlineProps['error']
  debugTarget?: string
  worktreeAvailable: boolean
  chatDock: 'left' | 'right'
  hosted: boolean
  openFlow: NonNullable<SearchProps['onOpenFlow']>
  openArch: (blockId: string) => void
  openNode: SearchProps['onOpen']
  openNodeId: TreeProps['onOpenNode']
  openCode: (file: string, line?: number, lineEnd?: number, column?: number) => void
  previewCode: NonNullable<TreeProps['onPreviewFile']>
  pinFile: NonNullable<TreeProps['onPinFile']>
  closeFile: NonNullable<TreeProps['onCloseFile']>
  renamePath: NonNullable<TreeProps['onRename']>
  trashPath: NonNullable<TreeProps['onTrash']>
  showSubgraph: NonNullable<SearchProps['onShowSubgraph']>
  openDiff: (file: string, staged: boolean, rev?: string, from?: string) => void
  openWorktrees?: () => void
  nodeImpact: NodeImpact | null
  impactPending: boolean
  changes: ChangesProps['changes']
  changesLoading: ChangesProps['loading']
  changesError: ChangesProps['error']
  reloadChanges: ChangesProps['onReload']
  reloadImpact: () => void
  clearImpact: () => void
}

export type WorkbenchPanelGroup = 'explore' | 'inspect' | 'run' | 'dock'

export interface WorkbenchPanel {
  id: string
  title: () => string
  icon: ReactNode
  command: string
  group: WorkbenchPanelGroup
  render: (ctx: WorkbenchPanelContext) => ReactNode
  visible?: (ctx: WorkbenchPanelContext) => boolean
}

const FilesIcon = h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('path', { d: 'M8 3h8l4 4v12H8zM15 3v5h5M4 7v14h12' }))
const FindIcon = h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('path', { d: 'M4 6h9M4 11h5M4 16h4' }), h('circle', { cx: 15.5, cy: 14.5, r: 3.5 }), h('path', { d: 'm18 17 3 3' }))
const SearchIcon = h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
  h('circle', { cx: 11, cy: 11, r: 6 }), h('path', { d: 'm20 20-4.5-4.5' }))
const TourIcon = h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
  h('circle', { cx: 12, cy: 12, r: 8 }), h('path', { d: 'm15.5 8.5-2 5-5 2 2-5z' }))
const ChangesIcon = h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
  h('circle', { cx: 6, cy: 6, r: 2.5 }), h('circle', { cx: 6, cy: 18, r: 2.5 }), h('circle', { cx: 18, cy: 12, r: 2.5 }),
  h('path', { d: 'M6 8.5v7M8.5 6C14 6 18 7 18 9.5' }))

/** Một mảng duy nhất: thêm bảng mới không phải sửa map titles, activities hay switch thân sidebar. */
export const WORKBENCH_PANELS: WorkbenchPanel[] = [
  {
    id: 'explorer', title: () => tr('Duyệt tệp'), icon: FilesIcon, command: 'explorer.toggle', group: 'explore',
    render: (ctx) => h(Fragment, null,
      h('div', { className: 'ws-project-root', title: ctx.projectPath }, h(Icon, { name: 'folder', size: 16 }), h('span', null, ctx.projectName)),
      h('div', { className: 'ws-tools-body' }, h(TreeView, {
        projectId: ctx.projectId, projectPath: ctx.projectPath, activeFile: ctx.activeFile ?? ctx.previewFile,
        revision: ctx.revision, dirtyFiles: ctx.dirtyFiles, compact: true,
        onRename: ctx.renamePath, onTrash: ctx.trashPath, onOpenNode: ctx.openNodeId, onOpenCode: ctx.openCode,
        onPreviewFile: ctx.previewCode, onPinFile: ctx.pinFile, onCloseFile: ctx.closeFile
      })))
  },
  {
    id: 'find', title: () => tr('Tìm trong tệp'), icon: FindIcon, command: 'project_search.toggle', group: 'explore',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(ProjectSearch, {
      projectId: ctx.projectId, dirtyFiles: ctx.dirtyFiles, focusRequest: ctx.findFocus,
      onOpen: (file, line) => ctx.openCode(file, line)
    }))
  },
  {
    id: 'outline', title: () => tr('Ký hiệu'), icon: h(Icon, { name: 'tree', size: 20 }), command: 'editor.document_symbols', group: 'inspect',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(OutlinePanel, { editor: ctx.editor, symbols: ctx.symbols, error: ctx.symbolError }))
  },
  {
    id: 'git', title: () => 'Git', icon: h(Icon, { name: 'branch', size: 20 }), command: 'git_panel.toggle', group: 'inspect',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(GitPanel, {
      projectId: ctx.projectId, onOpenDiff: ctx.openDiff, onOpenFile: (file) => ctx.openCode(file),
      onOpenWorktrees: ctx.openWorktrees
    }))
  },
  {
    id: 'debug', title: () => tr('Gỡ lỗi'), icon: h(Icon, { name: 'bug', size: 20 }), command: 'debug.toggle', group: 'run',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(DebugPanel, {
      projectId: ctx.projectId, target: ctx.debugTarget, onOpenFile: (file, line) => ctx.openCode(file, line)
    }))
  },
  {
    id: 'search', title: () => vi.activity.search, icon: SearchIcon, command: 'graph_search.toggle', group: 'explore',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(SearchPanel, {
      projectId: ctx.projectId, revision: ctx.revision, onOpen: ctx.openNode,
      onShowSubgraph: (g) => ctx.showSubgraph(g), onOpenFlow: ctx.openFlow
    }))
  },
  {
    id: 'changes', title: () => vi.activity.changes, icon: ChangesIcon, command: 'changes.toggle', group: 'inspect',
    render: (ctx) => h('div', { className: 'ws-tools-body' },
      ctx.nodeImpact && !ctx.impactPending
        ? h('button', { type: 'button', className: 'link back', onClick: ctx.clearImpact }, vi.impact.back)
        : null,
      h(ChangesPanel, {
        changes: ctx.changes, loading: ctx.impactPending || (!ctx.nodeImpact && ctx.changesLoading),
        error: ctx.nodeImpact || ctx.impactPending ? null : ctx.changesError,
        onReload: ctx.nodeImpact ? ctx.reloadImpact : ctx.reloadChanges,
        onOpenNode: ctx.openNodeId, onOpenCode: ctx.openCode
      }))
  },
  {
    id: 'tour', title: () => vi.activity.tour, icon: TourIcon, command: 'tour.toggle', group: 'inspect',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(TourPanel, {
      projectId: ctx.projectId, revision: ctx.revision, projectName: ctx.projectName,
      onOpenFlow: ctx.openFlow, onOpenNode: ctx.openNodeId, onOpenArch: ctx.openArch
    }))
  },
  {
    id: 'diagnostics', title: () => tr('Lỗi trong dự án'), icon: h(Icon, { name: 'report', size: 20 }), command: 'editor.diagnostics', group: 'run',
    render: (ctx) => h('div', { className: 'ws-tools-body' }, h(DiagnosticsPanel, {
      projectId: ctx.projectId, onOpen: (file, line, column) => ctx.openCode(file, line, undefined, column)
    })),
    visible: () => false
  },
  {
    id: 'agent', title: () => vi.chat.title, icon: h(Icon, { name: 'spark', size: 20 }), command: 'agent.toggle', group: 'dock',
    render: () => null,
    visible: (ctx) => !ctx.hosted && ctx.chatDock === 'left'
  }
]

export function getWorkbenchPanel(id: string): WorkbenchPanel | undefined {
  return WORKBENCH_PANELS.find((panel) => panel.id === id)
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitWorktree } from '@shared/api'
import { errorText } from '../../state/errorText'
import { fuzzyFilter } from '../../state/fuzzy'
import { Icon } from '../common/icons'
import { Highlight, Picker } from '../layout/Picker'
import './git-panel.css'

type Choice = { kind: 'worktree'; worktree: GitWorktree } | { kind: 'create'; branch: string; existing: boolean }

const label = (worktree: GitWorktree) => ({
  name: worktree.path.split(/[\\/]/).filter(Boolean).pop() ?? worktree.path,
  detail: worktree.branch ?? 'HEAD tách rời'
})
/** Chuỗi để khớp mờ; phần hiển thị tô đúng chỗ khớp theo cùng thứ tự "tên nhánh". */
const textOf = (item: Choice): string => {
  if (item.kind === 'create') return item.branch
  const { name, detail } = label(item.worktree)
  return `${name} ${detail}`
}

/** Worktree của kho (cạnh bộ chọn nhánh): Enter mở thư mục worktree làm dự án; gõ tên nhánh để tạo worktree mới. */
export function WorktreePicker({ projectId, onClose, onOpen }: {
  projectId: string
  onClose: () => void
  /** Mở thư mục worktree làm dự án (nơi gọi lo việc rời dự án hiện tại). */
  onOpen: (path: string) => void
}) {
  const api = window.nexgraph.git
  const [data, setData] = useState<{ worktrees: GitWorktree[]; branches: string[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    if (!api) return setLoadError('Git không dùng được ở chế độ này.')
    try {
      const [worktrees, branches] = await Promise.all([api.worktrees(projectId), api.branches(projectId)])
      if (mounted.current) { setData({ worktrees, branches }); setLoadError(null) }
    } catch (error) {
      if (mounted.current) setLoadError(errorText(error))
    }
  }, [api, projectId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  const run = async (message: string, work: () => Promise<void>) => {
    busyRef.current = true
    setBusy(message)
    setActionError(null)
    try {
      await work()
    } catch (error) {
      if (mounted.current) setActionError(errorText(error))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(null)
    }
  }
  const changed = () => window.dispatchEvent(new CustomEvent('nexgraph:git-changed', { detail: projectId }))

  const pick = (choice: Choice) => {
    if (!api || busyRef.current) return
    if (choice.kind === 'create') {
      void run('Đang tạo worktree…', async () => {
        const path = await api.worktreeAdd(projectId, choice.branch, choice.existing)
        changed()
        if (mounted.current) { onOpen(path); onClose() }
      })
    } else if (choice.worktree.current) onClose()
    else if (choice.worktree.prunable) setActionError('Thư mục của worktree này không còn trên đĩa. Hãy xóa nó rồi tạo lại.')
    else { onOpen(choice.worktree.path); onClose() }
  }

  const remove = (worktree: GitWorktree) => {
    if (!api || busyRef.current || !window.confirm(`Xóa worktree “${label(worktree).name}”?\nThư mục ${worktree.path} sẽ bị xóa khỏi đĩa; nhánh vẫn được giữ.`)) return
    void run('Đang xóa worktree…', async () => {
      await api.worktreeRemove(projectId, worktree.path)
      changed()
      await load()
    })
  }

  const choices: Choice[] = busy ? [] : (data?.worktrees ?? []).map((worktree) => ({ kind: 'worktree', worktree }))
  return <Picker label="Worktree" placeholder="Chọn worktree hoặc gõ tên nhánh để tạo mới…" items={choices}
    itemKey={(item) => item.kind === 'create' ? `create:${item.branch}` : `worktree:${item.worktree.path}`} itemText={textOf}
    filter={(items, query) => {
      const matches = fuzzyFilter(items, query, textOf)
      const branch = query.trim().replace(/\s+/g, '-')
      // Nhánh đang checkout ở một worktree thì đã có trong danh sách (git cũng không cho checkout hai nơi).
      if (data && !busy && branch && !data.worktrees.some((worktree) => worktree.branch === branch)) {
        matches.push({ item: { kind: 'create', branch, existing: data.branches.includes(branch) }, positions: [] })
      }
      return matches
    }}
    empty={busy ?? (data ? 'Không có worktree.' : loadError ? 'Không thể tải worktree.' : 'Đang tải worktree…')}
    error={actionError ?? loadError} onCancel={() => { if (!busyRef.current) onClose() }} onPick={pick}
    footer={(item, go) => {
      if (item.kind === 'create') return <button type="button" onClick={go}>Tạo và mở <kbd>↵</kbd></button>
      const { worktree } = item
      const why = worktree.main ? 'Không xóa được worktree chính' : worktree.current ? 'Đang mở' : worktree.locked ? 'Worktree đang bị khóa' : undefined
      return <>
        <button type="button" disabled={!!why} title={why} onClick={() => remove(worktree)}>Xóa worktree</button>
        <button type="button" onClick={go}>{worktree.current ? 'Đang mở' : 'Mở'} <kbd>↵</kbd></button>
      </>
    }}
    renderItem={(item, positions) => {
      if (item.kind === 'create') {
        return <>
          <Icon name="plus" size={14} />
          <span className="git-branch-create">{item.existing ? `Tạo worktree cho nhánh có sẵn “${item.branch}”` : `Tạo worktree với nhánh mới “${item.branch}” từ HEAD`}</span>
        </>
      }
      const { worktree } = item
      const { name, detail } = label(worktree)
      const flags = [worktree.main && 'chính', worktree.current && 'đang mở', worktree.locked && 'khóa', worktree.prunable && 'mất thư mục'].filter(Boolean)
      return <>
        <Icon name={worktree.current ? 'check' : 'folder'} size={14} />
        <span title={worktree.path}><Highlight text={name} positions={positions} /></span>
        <small><Highlight text={detail} positions={positions} offset={Array.from(name).length + 1} /> · {[worktree.head.slice(0, 7), ...flags].join(' · ')}</small>
      </>
    }} />
}

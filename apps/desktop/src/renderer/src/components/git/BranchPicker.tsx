import { useEffect, useRef, useState } from 'react'
import { errorText } from '../../state/errorText'
import { fuzzyFilter } from '../../state/fuzzy'
import { Icon } from '../common/icons'
import { Highlight, Picker } from '../layout/Picker'

type BranchChoice = { name: string; create: boolean }

export function BranchPicker({ projectId, onClose, onChanged }: {
  projectId: string
  onClose: () => void
  onChanged: () => void
}) {
  const api = window.nexgraph.git
  const [result, setResult] = useState<{ projectId: string; branches: string[] | null; error: string | null }>({ projectId, branches: null, error: null })
  const [actionError, setActionError] = useState<{ projectId: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const currentProject = useRef(projectId)
  const mounted = useRef(true)
  currentProject.current = projectId

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let active = true
    setResult({ projectId, branches: null, error: null })
    if (!api) {
      setResult({ projectId, branches: null, error: 'Git không dùng được ở chế độ này.' })
    } else {
      api.branches(projectId).then((branches) => {
        if (active) setResult({ projectId, branches, error: null })
      }).catch((error: unknown) => {
        if (active) setResult({ projectId, branches: null, error: errorText(error) })
      })
    }
    return () => { active = false }
  }, [api, projectId])

  const branches = result.projectId === projectId ? result.branches : null
  const loadError = result.projectId === projectId ? result.error : null
  const error = (actionError?.projectId === projectId ? actionError.message : null) ?? loadError
  const loading = !branches && !loadError
  const choices: BranchChoice[] = busy ? [] : (branches ?? []).map((name) => ({ name, create: false }))

  const pick = async (choice: BranchChoice) => {
    if (!api || !branches || busyRef.current || currentProject.current !== projectId) return
    busyRef.current = true
    setBusy(true)
    setActionError(null)
    let switched = false
    try {
      await api.switchBranch(projectId, choice.name, choice.create)
      switched = true
    } catch (error) {
      if (mounted.current && currentProject.current === projectId) setActionError({ projectId, message: errorText(error) })
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
    if (!switched) return
    window.dispatchEvent(new CustomEvent('nexgraph:git-changed', { detail: projectId }))
    if (mounted.current && currentProject.current === projectId) { onChanged(); onClose() }
  }

  return <div className="git-branch-container" aria-busy={busy || loading}>
    <Picker label="Chuyển nhánh" placeholder="Tìm hoặc tạo nhánh…" className="git-branch-picker" items={choices}
      itemKey={(item) => `${item.create ? 'create' : 'branch'}:${item.name}`} itemText={(item) => item.name}
      filter={(items, query) => {
        const matches = fuzzyFilter(items, query, (item) => item.name)
        const name = query.trim()
        if (branches && !busy && name && !branches.includes(name)) matches.push({ item: { name, create: true }, positions: [] })
        return matches
      }}
      empty={busy ? 'Đang chuyển nhánh…' : loading ? 'Đang tải nhánh…' : loadError ? 'Không thể tải nhánh.' : 'Không có nhánh.'}
      error={error} onCancel={() => { if (!busyRef.current) onClose() }} onPick={(item) => void pick(item)}
      renderItem={(item, positions) => item.create ? <>
        <Icon name="plus" size={14} />
        <span className="git-branch-create">Tạo nhánh “{item.name}” từ HEAD</span>
      </> : <>
        <Icon name="branch" size={14} />
        <span className="git-branch-name"><Highlight text={item.name} positions={positions} /></span>
      </>} />
  </div>
}

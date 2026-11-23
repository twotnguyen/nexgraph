import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStash } from '@shared/api'
import { errorMsg } from '../../state/errorText'
import { msgText, type Message } from '../../state/messages'
import { Icon } from '../common/icons'
import { PopoverMenu } from '../common/PopoverMenu'
import { tr } from '../../strings'

type StashList = { projectId: string; items: GitStash[] | null; error: Message | null }

export function StashSection({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const api = window.nexgraph.git
  const [list, setList] = useState<StashList>({ projectId, items: null, error: null })
  const [draft, setDraft] = useState({ projectId, message: '' })
  const [actionError, setActionError] = useState<{ projectId: string; message: Message } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const sequence = useRef(0)
  const currentProject = useRef(projectId)
  const mounted = useRef(true)
  currentProject.current = projectId

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async () => {
    const ticket = ++sequence.current
    setList({ projectId, items: null, error: null })
    try {
      if (!api) throw new Error(tr('Git không dùng được ở chế độ này.'))
      const items = await api.stashes(projectId)
      if (ticket === sequence.current) setList({ projectId, items, error: null })
    } catch (error) {
      if (ticket === sequence.current) setList({ projectId, items: null, error: errorMsg(error) })
    }
  }, [api, projectId])

  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === projectId) void refresh()
    }
    window.addEventListener('nexgraph:git-changed', changed)
    void refresh()
    return () => { sequence.current++; window.removeEventListener('nexgraph:git-changed', changed) }
  }, [projectId, refresh])

  const currentList = list.projectId === projectId ? list : null
  const loading = !currentList || (!currentList.items && !currentList.error)
  const message = draft.projectId === projectId ? draft.message : ''
  const error = actionError?.projectId === projectId ? actionError.message : null
  const disabled = busy || loading || !api

  const mutate = async (work: () => Promise<void>, clearMessage = false) => {
    if (!api || busyRef.current || loading || currentProject.current !== projectId) return
    busyRef.current = true
    setBusy(true)
    setActionError(null)
    try {
      await work()
      if (clearMessage && mounted.current && currentProject.current === projectId) setDraft({ projectId, message: '' })
    } catch (error) {
      if (mounted.current && currentProject.current === projectId) setActionError({ projectId, message: errorMsg(error) })
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
      // Git can leave partial worktree changes even when an operation reports an error.
      window.dispatchEvent(new CustomEvent('nexgraph:git-changed', { detail: projectId }))
      if (mounted.current && currentProject.current === projectId) onChanged()
    }
  }

  const actionDisabled = busy || !currentList?.items?.length || !api
  return <section className="git-stash-section" aria-label="Stash" aria-busy={busy || loading}>
    <header className="git-stash-header">
      <span>Stash</span>
      <button type="button" className="git-stash-refresh" aria-label={tr('Làm mới stash')} title={tr('Làm mới stash')} disabled={disabled} onClick={() => void refresh()}><Icon name="refresh" size={13} /></button>
    </header>
    <form className="git-stash-form" onSubmit={(event) => {
      event.preventDefault()
      if (api) void mutate(() => api.stashSave(projectId, message.trim()), true)
    }}>
      <input className="git-stash-message" aria-label={tr('Thông điệp stash')} placeholder={tr('Thông điệp (tùy chọn)')} value={message} disabled={disabled}
        onChange={(event) => setDraft({ projectId, message: event.target.value })} />
      <button type="submit" className="git-stash-save" disabled={disabled}>{tr('Lưu stash')}</button>
    </form>
    {error && <p className="git-stash-error" role="alert">{msgText(error)}</p>}
    {currentList?.error && <p className="git-stash-error" role="alert">{msgText(currentList.error)}</p>}
    {busy ? <p className="git-stash-status" role="status">{tr('Đang xử lý stash…')}</p>
      : loading ? <p className="git-stash-status" role="status">{tr('Đang tải stash…')}</p>
      : currentList?.items?.length === 0 ? <p className="git-stash-empty">{tr('Không có stash.')}</p>
        : <ul className="git-stash-list">{currentList?.items?.map((stash) => <li className="git-stash-row" key={stash.ref}>
          <span className="git-stash-ref">{stash.ref}</span><span className="git-stash-description">{stash.message}</span>
          <fieldset className="git-stash-actions" disabled={actionDisabled}>
            <PopoverMenu label={tr('Thao tác {ref}', { ref: stash.ref })} buttonClass="git-stash-action-trigger" trigger={<Icon name="more" size={14} />} items={[
              { label: tr('Áp dụng'), icon: 'download', onSelect: () => { if (api) void mutate(() => api.stashAction(projectId, stash.ref, 'apply')) } },
              { label: tr('Áp dụng và xóa'), icon: 'save', onSelect: () => { if (api) void mutate(() => api.stashAction(projectId, stash.ref, 'pop')) } },
              { label: tr('Xóa stash'), icon: 'trash', onSelect: () => {
                if (api && !busyRef.current && currentProject.current === projectId && window.confirm(tr('Xóa {ref} “{message}”? Không thể hoàn tác.', { ref: stash.ref, message: stash.message }))) {
                  void mutate(() => api.stashAction(projectId, stash.ref, 'drop'))
                }
              } }
            ]} />
          </fieldset>
        </li>)}</ul>}
  </section>
}

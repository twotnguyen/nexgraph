import { useEffect, useMemo, useRef, useState } from 'react'
import { errorMsg } from '../lib/errorText'
import { fuzzyMatch } from '../lib/fuzzy'
import { FileTypeIcon } from './FileTypeIcon'
import { Icon } from './icons'
import { Highlight, Picker } from './Picker'
import { tr } from '../../i18n/strings'
import { msg, msgText, type Message } from '../lib/messages'

type FileItem = { path: string; kind: 'file' | 'recent' | 'create' }
const fileKey = (item: FileItem) => `${item.kind}:${item.path}`
const fileText = (item: FileItem) => item.path
const LIMIT = 200

/** Khớp tên tệp trước (điểm cộng lớn), không được thì khớp cả đường dẫn; như tìm tệp của Wu. */
export function rankFiles(files: readonly string[], query: string): { item: string; positions: number[] }[] {
  if (!query.trim()) return files.slice(0, LIMIT).map((item) => ({ item, positions: [] }))
  const out: { item: string; positions: number[]; score: number }[] = []
  for (const path of files) {
    const cut = path.lastIndexOf('/') + 1
    const name = fuzzyMatch(query, path.slice(cut))
    if (name) {
      const offset = Array.from(path.slice(0, cut)).length
      out.push({ item: path, score: name.score + 100, positions: name.positions.map((p) => p + offset) })
      continue
    }
    const full = fuzzyMatch(query, path)
    if (full) out.push({ item: path, ...full })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, LIMIT)
}

/** ⌘P: hiện lịch sử khi chưa gõ; tìm hoặc tạo tệp khi nhập đường dẫn. */
export function FileFinder({ projectId, projectName, recent, onOpen, onClose }: { projectId: string; projectName: string; recent: readonly string[]; onOpen: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<{ projectId: string; files: string[] } | null>(null)
  const [error, setError] = useState<Message | null>(null)
  const creating = useRef(false)
  const mounted = useRef(true)
  const currentProject = useRef(projectId)
  currentProject.current = projectId
  const files = listing?.projectId === projectId ? listing.files : null
  const items = useMemo<FileItem[]>(() => (files ?? []).map((path) => ({ path, kind: 'file' })), [files])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let live = true
    setError(null)
    const load = window.nexgraph.fs.files
    if (!load) { setError(msg('Không liệt kê được tệp ở chế độ này')); return }
    load(projectId).then(({ files: all }) => {
      if (live) setListing({ projectId, files: all })
    }).catch((e: unknown) => { if (live) setError(errorMsg(e)) })
    return () => { live = false }
  }, [projectId])

  const filter = (indexed: readonly FileItem[], query: string): { item: FileItem; positions: number[] }[] => {
    const path = query.trim()
    if (!path) return [...new Set(recent)].map((item) => ({ item: { path: item, kind: 'recent' }, positions: [] }))
    const matches: { item: FileItem; positions: number[] }[] = rankFiles([...new Set([...recent, ...indexed.map((item) => item.path)])], query)
      .map(({ item, positions }) => ({ item: { path: item, kind: 'file' }, positions }))
    if (files && !files.includes(path) && !recent.includes(path) && !/^(?:\/|[A-Za-z]:)/.test(path) && !/[\\\x00-\x1f]/.test(path)
      && path.split('/').every((part) => part && part !== '.' && part !== '..')) {
      matches.push({ item: { path, kind: 'create' }, positions: [] })
    }
    return matches
  }

  const pick = async (item: FileItem) => {
    if (creating.current) return
    setError(null)
    if (item.kind !== 'create') { onClose(); onOpen(item.path); return }
    const createFile = window.nexgraph.fs.createFile
    if (!createFile) { setError(msg('Không tạo được tệp ở chế độ này')); return }
    creating.current = true
    try {
      await createFile(projectId, item.path)
      if (mounted.current && currentProject.current === projectId) { onClose(); onOpen(item.path) }
    } catch (e: unknown) {
      if (mounted.current && currentProject.current === projectId) setError(errorMsg(e))
    } finally {
      creating.current = false
    }
  }

  return (
    <Picker label={tr('Tìm tệp')} placeholder={tr('Tìm tệp…')} className="file-finder" items={items} itemKey={fileKey} itemText={fileText} filter={filter}
      empty={files ? tr('Không có tệp khớp') : error ? tr('Không có tệp để tìm') : tr('Đang liệt kê tệp…')} error={error ? msgText(error) : undefined} onCancel={onClose}
      onPick={(item) => { void pick(item) }}
      itemData={(item) => ({ 'data-path': item.path })}
      renderItem={(item, positions) => {
        const { path } = item
        if (item.kind === 'create') return <><Icon name="plus" size={16} /><span>{tr('Tạo tệp {path}?', { path })}</span></>
        const cut = path.lastIndexOf('/') + 1
        const offset = Array.from(path.slice(0, cut)).length
        return <>
          <FileTypeIcon name={path.slice(cut)} />
          <b><Highlight text={path.slice(cut)} positions={positions.filter((p) => p >= offset)} offset={offset} /></b>
          <span className="picker-dir">{projectName}/<Highlight text={path.slice(0, cut)} positions={positions.filter((p) => p < offset)} /></span>
          {item.kind === 'recent' && <span className="picker-history" role="img" aria-label={tr('Mở gần đây')} title={tr('Mở gần đây')}><Icon name="history" size={14} /></span>}
        </>
      }} />
  )
}

import { useEffect, useState } from 'react'
import { fuzzyMatch } from '../../state/fuzzy'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Highlight, Picker } from './Picker'

const fileKey = (path: string) => path
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

/** ⌘P: tệp mở gần đây đứng đầu khi chưa gõ; Enter mở tệp trong editor. */
export function FileFinder({ projectId, recent, onOpen, onClose }: { projectId: string; recent: readonly string[]; onOpen: (path: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = window.nexgraph.fs.files
    if (!load) { setError('Không liệt kê được tệp ở chế độ này'); return }
    load(projectId).then(({ files: all }) => {
      if (!live) return
      const head = recent.filter((path) => all.includes(path))
      setFiles([...head, ...all.filter((path) => !head.includes(path))])
    }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [projectId, recent])

  return (
    <Picker label="Tìm tệp" placeholder="Tìm tệp…" className="file-finder" items={files ?? []} itemKey={fileKey} itemText={fileKey} filter={rankFiles}
      empty={error ?? (files ? 'Không có tệp khớp' : 'Đang liệt kê tệp…')} onCancel={onClose}
      onPick={(path) => { onClose(); onOpen(path) }}
      itemData={(path) => ({ 'data-path': path })}
      renderItem={(path, positions) => {
        const cut = path.lastIndexOf('/') + 1
        const offset = Array.from(path.slice(0, cut)).length
        return <>
          <FileTypeIcon name={path.slice(cut)} />
          <b><Highlight text={path.slice(cut)} positions={positions.filter((p) => p >= offset)} offset={offset} /></b>
          <span className="picker-dir"><Highlight text={path.slice(0, cut)} positions={positions.filter((p) => p < offset)} /></span>
        </>
      }} />
  )
}

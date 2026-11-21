import { useEffect, useMemo, useState } from 'react'
import type { GitCommit, GitFileChange } from '@shared/api'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Icon } from '../common/icons'
import { errorText } from '../../state/errorText'
import { assignLanes, type GraphRow } from './graph'

interface Props {
  projectId: string
  onOpenDiff: (file: string, staged: boolean, rev?: string, from?: string) => void
}

type HistoryState = { projectId: string; graph: boolean; commits: GitCommit[] | null; error: string | null }
type FilesState = { projectId: string; sha: string; files: GitFileChange[] | null; error: string | null }

const laneX = (lane: number) => lane * 14 + 9
const relativeTime = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' })
const STATUS: Record<string, string> = { A: 'Thêm mới', M: 'Đã sửa', D: 'Đã xoá', R: 'Đổi tên', C: 'Sao chép', T: 'Đổi loại' }

function timeAgo(time: number): string {
  const seconds = time - Date.now() / 1000
  const spans: [number, Intl.RelativeTimeFormatUnit][] = [
    [31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']
  ]
  const [size, unit] = spans.find(([n]) => Math.abs(seconds) >= n) ?? spans[spans.length - 1]
  return relativeTime.format(Math.round(seconds / size), unit)
}

function HistoryGraph({ row, width }: { row: GraphRow; width: number }) {
  const x = laneX(row.lane)
  return (
    <svg className="git-history-graph" width={width} height={44} viewBox={`0 0 ${width} 44`} aria-hidden="true" style={{ flex: 'none' }}>
      {row.through.map(({ from, to }) => (
        <path key={`${from}:${to}`} className={`git-history-lane git-history-lane-${from % 6}`} fill="none" stroke="currentColor" strokeWidth="1.5"
          d={`M ${laneX(from)} 0 C ${laneX(from)} 22 ${laneX(to)} 22 ${laneX(to)} 44`} />
      ))}
      {row.incoming && <path className={`git-history-lane git-history-lane-${row.lane % 6}`} fill="none" stroke="currentColor" strokeWidth="1.5" d={`M ${x} 0 V 22`} />}
      {row.parents.map((to, index) => (
        <path key={`${to}:${index}`} className={`git-history-lane git-history-lane-${to % 6}`} fill="none" stroke="currentColor" strokeWidth="1.5"
          d={`M ${x} 22 C ${x} 33 ${laneX(to)} 33 ${laneX(to)} 44`} />
      ))}
      <circle className={`git-history-node git-history-lane-${row.lane % 6}`} cx={x} cy={22} r={3.5} fill="currentColor" />
    </svg>
  )
}

export function GitHistory({ projectId, onOpenDiff }: Props) {
  const api = window.nexgraph.git
  const [graph, setGraph] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [history, setHistory] = useState<HistoryState | null>(null)
  const [open, setOpen] = useState<{ projectId: string; sha: string } | null>(null)
  const [fileState, setFileState] = useState<FilesState | null>(null)
  const expanded = open?.projectId === projectId ? open.sha : null
  const current = history?.projectId === projectId && history.graph === graph ? history : null
  const commits = current?.commits
  const rows = useMemo(() => graph && commits ? assignLanes(commits) : [], [graph, commits])
  const graphWidth = Math.max(1, ...rows.map((row) => row.width)) * 14 + 4

  useEffect(() => {
    if (!api) return
    let live = true
    setHistory({ projectId, graph, commits: null, error: null })
    api.history(projectId, graph).then(
      (commits) => { if (live) setHistory({ projectId, graph, commits, error: null }) },
      (error: unknown) => { if (live) setHistory({ projectId, graph, commits: null, error: errorText(error) }) }
    )
    return () => { live = false }
  }, [api, projectId, graph, refresh])

  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === projectId) setRefresh((n) => n + 1)
    }
    const focus = () => setRefresh((n) => n + 1)
    window.addEventListener('nexgraph:git-changed', changed)
    window.addEventListener('focus', focus)
    return () => { window.removeEventListener('nexgraph:git-changed', changed); window.removeEventListener('focus', focus) }
  }, [projectId])

  useEffect(() => {
    if (!api || !expanded) return
    let live = true
    setFileState({ projectId, sha: expanded, files: null, error: null })
    api.commitFiles(projectId, expanded).then(
      (files) => { if (live) setFileState({ projectId, sha: expanded, files, error: null }) },
      (error: unknown) => { if (live) setFileState({ projectId, sha: expanded, files: null, error: errorText(error) }) }
    )
    return () => { live = false }
  }, [api, projectId, expanded])

  if (!api) return <p className="git-history-empty muted">Git không dùng được ở chế độ này.</p>

  return (
    <div className="git-history">
      <div className="git-history-toolbar" aria-label="Chế độ lịch sử">
        <button type="button" className="git-history-mode" aria-pressed={!graph} onClick={() => setGraph(false)}>Danh sách</button>
        <button type="button" className="git-history-mode" aria-pressed={graph} onClick={() => setGraph(true)}>Đồ thị</button>
        <button type="button" className="git-history-mode" aria-label="Làm mới lịch sử" title="Làm mới" onClick={() => setRefresh((n) => n + 1)}><Icon name="refresh" size={14} /></button>
      </div>
      {current?.error && <p className="git-history-error" role="alert">{current.error}</p>}
      {!current?.error && !commits && <p className="git-history-empty muted" role="status">Đang tải lịch sử…</p>}
      {commits?.length === 0 && <p className="git-history-empty muted">Chưa có commit.</p>}
      {!!commits?.length && <ul className="git-history-list">
        {commits.map((commit, index) => {
          const row = rows[index]
          const isOpen = expanded === commit.sha
          const files = isOpen && fileState?.projectId === projectId && fileState.sha === commit.sha ? fileState : null
          const date = new Date(commit.time * 1000)
          return (
            <li className="git-history-entry" key={commit.sha}>
              <div className="git-history-row">
                {graph && row && <HistoryGraph row={row} width={graphWidth} />}
                <button type="button" className="git-history-commit" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : { projectId, sha: commit.sha })}>
                  <span className="git-history-subject" title={commit.subject}>{commit.subject || '(Không có tiêu đề)'}</span>
                  {commit.refs && <span className="git-history-refs" title={commit.refs}>{commit.refs}</span>}
                  <span className="git-history-meta">{commit.sha.slice(0, 7)} · {commit.author} · <time dateTime={Number.isFinite(date.getTime()) ? date.toISOString() : undefined}>{timeAgo(commit.time)}</time></span>
                </button>
              </div>
              {isOpen && <div className="git-history-expanded" style={{ position: 'relative', paddingLeft: graph ? graphWidth : undefined }}>
                {graph && row && <svg className="git-history-continuation" width={graphWidth} height="100%" aria-hidden="true"
                  style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                  {Array.from({ length: row.outgoing }, (_, lane) => <line key={lane} className={`git-history-lane git-history-lane-${lane % 6}`}
                    x1={laneX(lane)} x2={laneX(lane)} y1="0" y2="100%" stroke="currentColor" strokeWidth="1.5" />)}
                </svg>}
                {files?.error && <p className="git-history-error" role="alert">{files.error}</p>}
                {!files?.error && !files?.files && <p className="git-history-empty muted" role="status">Đang tải tệp…</p>}
                {files?.files?.length === 0 && <p className="git-history-empty muted">Không có tệp thay đổi trong dự án.</p>}
                {!!files?.files?.length && <ul className="git-history-files">
                  {files.files.map((file) => <li key={file.path}>
                    <button type="button" className="git-history-file" title={file.from ? `${file.from} → ${file.path}` : file.path}
                      onClick={() => onOpenDiff(file.path, false, commit.sha, file.from)}>
                      <FileTypeIcon name={file.path} size={14} />
                      <span className="git-history-file-path">{file.path}</span>
                      <span className="git-history-file-status" data-status={file.status} aria-label={STATUS[file.status] ?? file.status}>{file.status}</span>
                    </button>
                  </li>)}
                </ul>}
              </div>}
            </li>
          )
        })}
      </ul>}
    </div>
  )
}

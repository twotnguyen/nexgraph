import type { ProjectSummary, ScanInfo } from '@shared/graph-types'
import { vi } from '../strings'

interface Props {
  project: ProjectSummary
  scan: ScanInfo
  /** `null` = lập chỉ mục toàn bộ dự án. */
  onChoose: (subdir: string | null) => void
  onCancel: () => void
}

export function LargeProjectScreen({ project, scan, onChoose, onCancel }: Props) {
  return (
    <main className="screen">
      <h1>{project.name}</h1>
      <p>{vi.large.message(scan.files, scan.threshold)}</p>
      <p className="muted">{vi.large.hint}</p>
      {scan.top_dirs.length > 0 && (
        <ul className="recent">
          {scan.top_dirs.map((d) => (
            <li key={d.path}>
              <button type="button" onClick={() => onChoose(d.path)}>
                <b className="mono">{d.path}</b> <span className="muted">{vi.large.files(d.files)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" onClick={onCancel}>{vi.large.cancel}</button>
        <button type="button" className="primary" onClick={() => onChoose(null)}>{vi.large.all}</button>
      </div>
    </main>
  )
}

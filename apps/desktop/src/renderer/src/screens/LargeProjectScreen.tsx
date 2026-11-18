import type { ProjectSummary, ScanInfo } from '@shared/graph-types'
import { vi } from '../strings'
import { Icon } from '../components/common/icons'

interface Props {
  project: ProjectSummary
  scan: ScanInfo
  /** `null` = lập chỉ mục toàn bộ dự án. */
  onChoose: (subdir: string | null) => void
  onCancel: () => void
}

export function LargeProjectScreen({ project, scan, onChoose, onCancel }: Props) {
  return (
    <main className="screen task-screen">
      <div className="page-title">
        <span className="page-icon"><Icon name="folder" size={23} /></span>
        <div><h1>{project.name}</h1><p className="muted">Chọn phạm vi lập chỉ mục</p></div>
      </div>
      <section className="workbench-panel">
        <div className="inline-message warning">{vi.large.message(scan.files, scan.threshold)}</div>
        <p className="panel-instruction muted">{vi.large.hint}</p>
        {scan.top_dirs.length > 0 && <ul className="recent">
          {scan.top_dirs.map((d) => (
            <li key={d.path}>
              <button type="button" className="recent-open" onClick={() => onChoose(d.path)}>
                <span className="recent-icon"><Icon name="folder" size={16} /></span>
                <span className="recent-identity"><b className="mono">{d.path}</b><span className="muted">{vi.large.files(d.files)}</span></span>
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>}
      </section>
      <div className="actions">
        <button type="button" onClick={onCancel}>{vi.large.cancel}</button>
        <button type="button" className="primary" onClick={() => onChoose(null)}>{vi.large.all}</button>
      </div>
    </main>
  )
}

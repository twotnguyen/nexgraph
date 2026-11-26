import type { ProjectSummary, ScanInfo } from '@nexgraph/contracts/graph-types'
import { vi, tr } from '../../i18n/strings'
import { Icon } from '../../shared/ui/icons'
import './welcome.css'

interface Props {
  project: ProjectSummary
  scan: ScanInfo
  /** `null` = lập chỉ mục toàn bộ dự án. */
  onChoose: (subdir: string | null) => void
  onCancel: () => void
}

export function LargeProjectScreen({ project, scan, onChoose, onCancel }: Props) {
  return (
    <main className="screen task-screen welcome-page large-wu">
      <div className="welcome">
        <header className="welcome-head">
          <span className="welcome-icon"><Icon name="folder" size={22} /></span>
          <div><h1>{project.name}</h1><p>{tr('Chọn phạm vi lập chỉ mục')}</p></div>
        </header>
        <div className="inline-message warning">{vi.large.message(scan.files, scan.threshold)}</div>
        {scan.top_dirs.length > 0 && <section className="welcome-section" aria-labelledby="large-dirs">
          <h2 id="large-dirs" className="welcome-section-title">{tr('Thư mục con')}</h2>
          <p className="welcome-hint">{vi.large.hint}</p>
          <ul className="welcome-list">
            {scan.top_dirs.map((d) => (
              <li key={d.path}>
                <button type="button" className="welcome-row" onClick={() => onChoose(d.path)}>
                  <Icon name="folder" size={14} />
                  <span className="welcome-row-main mono">{d.path}</span>
                  <span className="welcome-row-meta">{vi.large.files(d.files)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>}
        <div className="actions welcome-actions">
          <button type="button" onClick={onCancel}>{vi.large.cancel}</button>
          <button type="button" className="primary" onClick={() => onChoose(null)}>{vi.large.all}</button>
        </div>
      </div>
    </main>
  )
}

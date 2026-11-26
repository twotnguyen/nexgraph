import { useEffect, useMemo, useRef, useState } from 'react'
import { FileTypeIcon } from '../../shared/ui/FileTypeIcon'
import { delimiterFor, parseDelimited } from './csv'
import { observeBuffer } from './modelBuffer'
import './table-viewer.css'
import { tr } from '../../i18n/strings'

/** Số dòng dữ liệu tối đa dựng ra DOM; phần còn lại xem ở mã nguồn. */
export const MAX_ROWS = 5000

interface Props {
  projectId: string
  file: string
  active?: boolean
  loadError?: string | null
  onViewSource: () => void
}

/** Xem CSV/TSV dạng bảng trên cùng bộ đệm Monaco, kể cả nội dung chưa lưu. Dòng đầu là tiêu đề; cột # là dòng của bản ghi trong tệp nguồn. */
export function TableViewer({ projectId, file, active = true, loadError, onViewSource }: Props) {
  const [text, setText] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setText(null)
    const buffer = observeBuffer(projectId, file, setText)
    return () => buffer.dispose()
  }, [projectId, file])
  useEffect(() => { if (active) host.current?.focus() }, [active])
  // Dữ liệu dòng đầu + MAX_ROWS dòng: đọc thêm một bản ghi để biết có bị cắt hay không.
  const table = useMemo(() => text === null ? null : parseDelimited(text, delimiterFor(file) ?? ',', MAX_ROWS + 1), [text, file])
  const [header, ...rows] = table?.rows ?? []
  return <div ref={host} tabIndex={-1} data-mirror-file={file} className="code-viewer editor-tab table-viewer" style={active ? undefined : { display: 'none' }}>
    <header className="code-head">
      <span className="editor-path mono" title={file}><FileTypeIcon name={file} size={14} /> {tr('Bảng {name}', { name: file })}</span>
      <span className="ws-editor-actions"><button type="button" aria-label={tr('Xem mã nguồn')} title={tr('Xem mã nguồn')} onClick={onViewSource}>{tr('Mã nguồn')}</button></span>
    </header>
    {table?.truncated && <p role="status" className="stale-banner">{tr('Chỉ hiển thị {count} dòng dữ liệu đầu tiên; xem phần còn lại ở mã nguồn.', { count: MAX_ROWS })}</p>}
    <div className="tv-scroll">
      {loadError ? <p role="alert" className="error">{loadError}</p> : !table ? <p className="muted">{tr('Đang mở nội dung…')}</p> : !header ? <p className="muted">{tr('Không có dữ liệu để hiển thị (tệp trống, quá lớn hoặc không phải văn bản).')}</p> :
        <table aria-label={file}>
          <thead><tr>
            <th scope="col" title={tr('Dòng trong tệp nguồn')}>#</th>
            {Array.from({ length: table.columns }, (_, column) => <th key={column} scope="col" title={header[column]}>{header[column] || tr('Cột {name}', { name: column + 1 })}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index}>
              <th scope="row">{table.lines[index + 1]}</th>
              {Array.from({ length: table.columns }, (_, column) => <td key={column} title={row[column]}>{row[column]}</td>)}
            </tr>)}
          </tbody>
        </table>}
    </div>
  </div>
}

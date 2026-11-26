import { useEffect, useState, type ComponentProps } from 'react'
import { useCommand } from '../../shared/lib/commands'
import { EditorTab } from '../editor/EditorTab'
import { delimiterFor } from './csv'
import { ImageViewer, isImageFile } from './ImageViewer'
import { observeBuffer } from './modelBuffer'
import { TableViewer } from './TableViewer'

/** SVG giữ nguyên editor sau khi chuyển chế độ để không mất sửa đổi chưa lưu; CSV/TSV mở ở mã nguồn như Wu, bảng dựng từ cùng bộ đệm nên cũng không mất. */
export function FileView({ active = true, ...props }: ComponentProps<typeof EditorTab>) {
  const svg = /\.svg$/i.test(props.file)
  const delimited = delimiterFor(props.file) !== null
  const [showSource, setShowSource] = useState(false)
  const [openedSource, setOpenedSource] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sourceText, setSourceText] = useState<string | null>(null)
  useEffect(() => {
    if (!svg || !openedSource) return
    const buffer = observeBuffer(props.projectId, props.file, setSourceText)
    return () => buffer.dispose()
  }, [svg, openedSource, props.projectId, props.file])
  useCommand('table.preview', () => setShowTable((shown) => !shown), active && delimited)
  if (delimited) return <>
    <EditorTab {...props} active={active && !showTable} onViewTable={() => setShowTable(true)}
      onLoadError={(file, error) => { setLoadError(error); props.onLoadError?.(file, error) }} />
    {showTable && <TableViewer projectId={props.projectId} file={props.file} active={active} loadError={loadError} onViewSource={() => setShowTable(false)} />}
  </>
  if (!isImageFile(props.file)) return <EditorTab {...props} active={active} />
  return <>
    {svg && openedSource && <EditorTab {...props} active={active && showSource} onViewImage={() => setShowSource(false)} />}
    <ImageViewer projectId={props.projectId} file={props.file} active={active && !showSource} onClose={props.onClose}
      sourceText={sourceText ?? undefined} onViewSource={svg ? () => { setOpenedSource(true); setShowSource(true) } : undefined} />
  </>
}

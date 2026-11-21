import { useEffect, useState, type ComponentProps } from 'react'
import { EditorTab } from '../editor/EditorTab'
import { ImageViewer, isImageFile } from './ImageViewer'
import { observeBuffer } from './modelBuffer'

/** SVG giữ nguyên editor sau khi chuyển chế độ để không mất sửa đổi chưa lưu. */
export function FileView({ active = true, ...props }: ComponentProps<typeof EditorTab>) {
  const svg = /\.svg$/i.test(props.file)
  const [showSource, setShowSource] = useState(false)
  const [openedSource, setOpenedSource] = useState(false)
  const [sourceText, setSourceText] = useState<string | null>(null)
  useEffect(() => {
    if (!svg || !openedSource) return
    const buffer = observeBuffer(props.projectId, props.file, setSourceText)
    return () => buffer.dispose()
  }, [svg, openedSource, props.projectId, props.file])
  if (!isImageFile(props.file)) return <EditorTab {...props} active={active} />
  return <>
    {svg && openedSource && <EditorTab {...props} active={active && showSource} onViewImage={() => setShowSource(false)} />}
    <ImageViewer projectId={props.projectId} file={props.file} active={active && !showSource} onClose={props.onClose}
      sourceText={sourceText ?? undefined} onViewSource={svg ? () => { setOpenedSource(true); setShowSource(true) } : undefined} />
  </>
}

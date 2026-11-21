import { useEffect, useRef, useState } from 'react'
import { createMirror, type MirrorHandle } from './monaco'
import { Icon } from '../common/icons'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { useVimMode } from '../../state/editorPrefs'

/**
 * Khung phải khi chia đôi (⌘\): thêm một view trên cùng model của tệp đã mở, như split pane của Wu.
 * Sửa ở đây là sửa cùng bộ đệm với thẻ tệp; lưu bằng ⌘S khi tiêu điểm ở khung này (EditorTab nhận qua data-mirror-file).
 */
export function SplitEditor({ file, onClose }: { file: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [missing, setMissing] = useState(false)
  const vim = useVimMode()
  const [vimNode, setVimNode] = useState<HTMLElement | null>(null)
  const mirror = useRef<MirrorHandle | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let tries = 0
    // Thẻ tệp có thể chưa nạp xong model: thử lại vài lần.
    const attach = () => {
      if (!host.current) return
      mirror.current = createMirror(host.current, file)
      if (mirror.current) {
        setMissing(false)
        mirror.current.onDisposeModel(() => closeRef.current())
      } else if (++tries < 20) timer = setTimeout(attach, 100)
      else setMissing(true)
    }
    attach()
    return () => {
      clearTimeout(timer)
      mirror.current?.dispose()
      mirror.current = null
    }
  }, [file])

  useEffect(() => { mirror.current?.setVim(vim ? vimNode : null) }, [vim, vimNode, missing])

  return (
    <div className="code-viewer editor-tab editor-side" data-mirror-file={file}>
      <header className="code-head">
        <span className="editor-path mono" title={file}><FileTypeIcon name={file} size={14} /> <span>{file.split('/').pop()}</span></span>
        <span className="ws-editor-actions">
          {vim && <span className="vim-status muted" ref={setVimNode} />}
          <button type="button" className="ws-icon-button" aria-label="Đóng khung chia đôi" title="Đóng khung chia đôi (⌘\)" onClick={onClose}><Icon name="close" size={15} /></button>
        </span>
      </header>
      {missing && <p role="alert" className="ws-editor-loading muted">Không mở được tệp ở khung này.</p>}
      <div ref={host} className="editor-host" />
    </div>
  )
}

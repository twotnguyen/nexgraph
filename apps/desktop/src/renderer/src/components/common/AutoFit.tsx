import { useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'

/**
 * `fitView` ban đầu của React Flow chạy khi khung chưa có kích thước và nút chưa đo, nên thu phóng sai (kẹt ở mức
 * tối đa). Căn lại khi khung đã có kích thước và mọi nút đã được đo. Không dùng `useNodesInitialized` vì với nút
 * dựng sẵn kích thước (`initialWidth`) nó không bao giờ thành `true` ở bản Electron thật.
 */
export function AutoFit() {
  const ready = useStore(
    (s) =>
      s.width > 0 &&
      s.height > 0 &&
      s.nodeLookup.size > 0 &&
      Array.from(s.nodeLookup.values()).every((n) => !!n.measured.width && !!n.measured.height)
  )
  // Khung vẽ đổi cỡ sau lần vừa đầu (cột Các bước hiện ra, kéo cửa sổ) thì vừa lại, nếu không nút đầu bị cắt.
  const size = useStore((s) => `${s.width}x${s.height}`)
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (ready) void fitView({ padding: 0.15 })
  }, [ready, size, fitView])
  return null
}

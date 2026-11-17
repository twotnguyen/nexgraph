import { BaseEdge, Handle, MarkerType, Position, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'

/**
 * Kiểu vẽ đồ thị dùng chung. Hai dạng nút:
 * - `dot` (hình tròn, nhãn dưới nút): mạng lân cận ở thẻ Graph, xếp đều trên các vòng tròn quanh nút tâm; cạnh là đoạn thẳng.
 * - `box` (ô chữ nhật bo góc, nhãn trong ô): sơ đồ khối ở thẻ Kiến trúc và chuỗi bước ở thẻ Luồng, xếp theo lớp thẳng hàng;
 *   cạnh đi theo tuyến vuông góc do bộ bố cục tính (không cắt qua ô).
 * Nhãn cạnh chỉ hiện khi rê chuột, trừ khi sơ đồ bật `show-edge-labels`.
 */

export const EDGE_COLOR = '#8a93b8' // trung tính, đọc được trên cả nền sáng và tối (marker SVG không nhận biến CSS)
export interface DotData extends Record<string, unknown> {
  label: string
  /** Dòng phụ dưới nhãn (loại nút, số tệp). */
  sub?: string
  /** Chữ nhỏ có màu (vd. "đã đổi", "chưa có test"). */
  tag?: string
  color: string
  /** Đường kính hình tròn. */
  size: number
  /** Nút được nhấn mạnh (tâm, bước hiện tại, nút đã đổi): thêm quầng. */
  strong?: boolean
  dashed?: boolean
}

/** Cỡ nút theo trọng số tương đối (0..1), như Graphify: nút nhiều liên kết to hơn. */
export const dotSize = (weight: number, min = 16, span = 24): number => Math.round(min + span * Math.max(0, Math.min(1, weight)))

/**
 * Xếp nút quanh một nút tâm: tâm ở giữa, các nút còn lại cách đều trên những vòng tròn đồng tâm.
 * Mỗi vòng chứa vừa đủ số nút để nhãn (rộng ~`slot`) không đè nhau. Trả về tâm của từng nút.
 */
export function radialLayout(ids: string[], center: string, slot = 150): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = { [center]: { x: 0, y: 0 } }
  const rest = ids.filter((id) => id !== center)
  let done = 0
  for (let ring = 1; done < rest.length; ring++) {
    const radius = 60 + ring * 170
    const count = Math.min(rest.length - done, Math.max(6, Math.floor((2 * Math.PI * radius) / slot)))
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count + (ring % 2 ? 0 : Math.PI / count) // vòng chẵn lệch nửa bước
      out[rest[done + i]] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
    }
    done += count
  }
  return out
}

export const BOX_W = 172
export const BOX_H = 48

const hidden: CSSProperties = { opacity: 0, left: '50%', top: '50%', pointerEvents: 'none' }

export function DotNode({ data, selected }: NodeProps<Node<DotData>>) {
  return (
    <div className={`dot-node${data.strong || selected ? ' strong' : ''}${data.dashed ? ' dashed' : ''}`}
      style={{ width: data.size, height: data.size, '--node-c': data.color } as CSSProperties} title={data.label}>
      {/* React Flow cần handle để nối cạnh; cạnh tự tính điểm đầu cuối nên handle ẩn ở tâm. */}
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
      <div className="dot-label">
        <b>{data.label}</b>
        {data.sub && <small className="kind">{data.sub}</small>}
        {data.tag && <small className="tag" style={{ color: data.color }}>{data.tag}</small>}
      </div>
    </div>
  )
}

export function BoxNode({ data, selected }: NodeProps<Node<DotData>>) {
  return (
    <div className={`box-node${data.strong || selected ? ' strong' : ''}${data.dashed ? ' dashed' : ''}`}
      style={{ width: BOX_W, height: BOX_H, '--node-c': data.color } as CSSProperties} title={data.label}>
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
      <b>{data.label}</b>
      <small className="kind">
        {data.sub}
        {data.tag && <span className="tag" style={{ color: data.color }}> · {data.tag}</span>}
      </small>
    </div>
  )
}

/** Điểm trên mép nút `n` theo hướng tới (tx, ty): mép hình tròn với nút `dot`, mép ô với nút `box`. */
function borderPoint(n: InternalNode, tx: number, ty: number, gap: number): { x: number; y: number } {
  const w = n.measured.width ?? 0
  const h = n.measured.height ?? w
  const cx = n.internals.positionAbsolute.x + w / 2
  const cy = n.internals.positionAbsolute.y + h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (n.type === 'dot') {
    const len = Math.hypot(dx, dy) || 1
    return { x: cx + (dx / len) * (w / 2 + gap), y: cy + (dy / len) * (w / 2 + gap) }
  }
  const k = 1 / Math.max(Math.abs(dx) / (w / 2 + gap), Math.abs(dy) / (h / 2 + gap), 1e-6)
  return { x: cx + dx * k, y: cy + dy * k }
}

const centre = (n: InternalNode): { x: number; y: number } =>
  ({ x: n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2, y: n.internals.positionAbsolute.y + (n.measured.height ?? n.measured.width ?? 0) / 2 })

/** Đoạn thẳng từ mép nút nguồn tới mép nút đích, để đầu mũi tên không bị nút che. */
export function DotEdge({ id, source, target, markerEnd, style, label }: EdgeProps) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (!s || !t) return null
  const a = centre(s)
  const b = centre(t)
  const from = borderPoint(s, b.x, b.y, 2)
  const to = borderPoint(t, a.x, a.y, 3)
  return (
    <BaseEdge id={id} path={`M ${from.x},${from.y} L ${to.x},${to.y}`} markerEnd={markerEnd} style={style}
      label={label} labelX={(from.x + to.x) / 2} labelY={(from.y + to.y) / 2} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />
  )
}

type Pt = { x: number; y: number }
const step = (from: Pt, to: Pt, d: number): Pt => {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d }
}

/** Đường gấp khúc qua các điểm, bo nhẹ ở chỗ rẽ. */
function roundedPath(p: Pt[], r = 7): string {
  let d = `M ${p[0].x},${p[0].y}`
  for (let i = 1; i < p.length - 1; i++) {
    const before = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
    const after = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y)
    const a = step(p[i], p[i - 1], Math.min(r, before / 2))
    const b = step(p[i], p[i + 1], Math.min(r, after / 2))
    d += ` L ${a.x},${a.y} Q ${p[i].x},${p[i].y} ${b.x},${b.y}`
  }
  return `${d} L ${p[p.length - 1].x},${p[p.length - 1].y}`
}

/** Cạnh đi theo tuyến vuông góc đã tính sẵn (`data.points`); nhãn đặt giữa đoạn dài nhất. Thiếu tuyến thì vẽ thẳng. */
export function RoutedEdge(props: EdgeProps) {
  const points = (props.data as { points?: Pt[] } | undefined)?.points
  if (!points || points.length < 2) return <DotEdge {...props} />
  let at = 0
  let longest = -1
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    if (len > longest) { longest = len; at = i }
  }
  return (
    <BaseEdge id={props.id} path={roundedPath(points)} markerEnd={props.markerEnd} style={props.style}
      label={props.label} labelX={(points[at].x + points[at + 1].x) / 2} labelY={(points[at].y + points[at + 1].y) / 2}
      labelBgPadding={[4, 2]} labelBgBorderRadius={4} />
  )
}

export const dotNodeTypes = { dot: DotNode, box: BoxNode }
export const dotEdgeTypes = { dot: DotEdge, routed: RoutedEdge }

/** Dựng một cạnh: thẳng giữa hai nút, hoặc theo tuyến `points` nếu có. `strong` cho cạnh đang tô (đường đi, luồng). */
export const dotEdge = (e: { id: string; source: string; target: string; label?: string; width?: number; strong?: boolean; points?: Pt[] }): Edge => {
  const color = e.strong ? 'var(--magenta)' : EDGE_COLOR
  return {
    id: e.id, source: e.source, target: e.target, type: e.points ? 'routed' : 'dot', data: { points: e.points }, label: e.label, animated: e.strong,
    // userSpaceOnUse: đầu mũi tên giữ cỡ cố định, không phình theo độ dày cạnh.
    markerEnd: { type: MarkerType.ArrowClosed, markerUnits: 'userSpaceOnUse', width: 11, height: 11, color: e.strong ? '#e23d94' : EDGE_COLOR },
    style: { stroke: color, strokeWidth: e.width ?? (e.strong ? 2 : 1.2), opacity: e.strong ? 1 : 0.8 }
  }
}

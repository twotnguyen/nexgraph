import type { ReactNode } from 'react'
import type { WorkspaceTab } from '../../screens/ProjectOverviewScreen'

export type Tone = 'blue' | 'teal' | 'magenta' | 'violet' | 'green' | 'amber'

// Mỗi thẻ xem có một màu riêng, dùng lại ở Tổng quan và thanh thẻ để người dùng nhận ra thẻ bằng màu.
export const VIEW_TONE: Record<WorkspaceTab, Tone> = {
  arch: 'blue', map: 'teal', flows: 'magenta', graph: 'violet', tree: 'green', report: 'amber'
}

const PATHS = {
  arch: <><rect x="3" y="3" width="7" height="6" rx="1.5" /><rect x="14" y="3" width="7" height="6" rx="1.5" /><rect x="8.5" y="15" width="7" height="6" rx="1.5" /><path d="M6.5 9v3h11V9M12 12v3" /></>,
  map: <path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20" />,
  flows: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h4a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3" /></>,
  graph: <><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="8" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="M8.1 6.4l7.7 1.2M7 8l4 8M16.9 9.9l-3.8 6.2" /></>,
  tree: <><path d="M6 3v15h5M6 9h5" /><rect x="13" y="6.5" width="8" height="5" rx="1.5" /><rect x="13" y="15.5" width="8" height="5" rx="1.5" /></>,
  report: <path d="M6 3h9l4 4v14H6zM9.5 17v-4M12.5 17v-7M15.5 17v-2" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
  sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  cluster: <><circle cx="8" cy="9" r="4" /><circle cx="16" cy="9" r="4" /><circle cx="12" cy="16" r="4" /></>,
  export: <path d="M12 15V4M8 8l4-4 4 4M5 14v5h14v-5" />,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16v4M17 18h4" />,
  commit: <><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

/** Dấu hiệu NexGraph: đồ thị tri thức tạo hình chữ N (Nexus + Graph). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M6 18V6l12 12V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".4" />
      <path d="M6 6l6-3 6 3M6 18l6 3 6-3" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity=".25" />
      <circle cx="6" cy="18" r="2.2" fill="var(--teal)" />
      <circle cx="6" cy="6" r="2.4" fill="var(--blue)" />
      <circle cx="18" cy="18" r="2.4" fill="var(--magenta)" />
      <circle cx="18" cy="6" r="2.2" fill="var(--amber)" />
      <circle cx="12" cy="12" r="2.6" fill="var(--violet)" />
      <circle cx="12" cy="3" r="1.3" fill="var(--violet)" />
      <circle cx="12" cy="21" r="1.3" fill="var(--green)" />
    </svg>
  )
}

// [x, y, bán kính, màu]; cạnh nối theo chỉ số. Toạ độ vẽ tay cho khung 460×240.
const ART_NODES: [number, number, number, string][] = [
  [60, 150, 7, 'blue'], [128, 78, 11, 'violet'], [150, 186, 6, 'teal'], [214, 128, 15, 'blue'], [232, 40, 6, 'amber'],
  [288, 196, 8, 'magenta'], [304, 84, 9, 'teal'], [366, 142, 12, 'magenta'], [384, 44, 6, 'green'], [428, 204, 6, 'violet'],
  [438, 98, 8, 'amber'], [18, 70, 5, 'green']
]
const ART_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 3], [1, 4], [3, 5], [3, 6], [4, 6], [6, 7], [5, 7], [6, 8], [7, 9], [7, 10], [8, 10], [11, 1], [11, 0]
]

/** Hình trang trí ở đầu trang: một mảnh đồ thị, màu theo loại nút. */
export function GraphArt() {
  return (
    <svg className="graph-art" viewBox="0 0 460 240" aria-hidden="true">
      {ART_EDGES.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={ART_NODES[a][0]} y1={ART_NODES[a][1]} x2={ART_NODES[b][0]} y2={ART_NODES[b][1]} />
      ))}
      {ART_NODES.map(([x, y, r, c], i) => (
        <g key={i} style={{ color: `var(--${c})` }}>
          <circle cx={x} cy={y} r={r + 6} fill="currentColor" opacity=".18" />
          <circle cx={x} cy={y} r={r} fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

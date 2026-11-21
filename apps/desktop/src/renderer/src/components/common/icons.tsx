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
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19" /></>,
  moon: <path d="M20.4 15A8.5 8.5 0 1 1 9 3.6 8 8 0 0 0 20.4 15z" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  commit: <><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>,
  pr: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 4l-2 2 2 2" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M18 9c0 5-12 3-12 8" /></>,
  save: <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3v5h7V3M8 21v-6h8v6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4" /><path d="M12 8v4l3 2" /></>,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  back: <path d="M15 6l-6 6 6 6" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />,
  panelLeft: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  panelRight: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  gear: <><path d="M19.13 10.44 21.52 10.8v2.4l-2.39.36-.98 2.38 1.44 1.94-1.71 1.71-1.94-1.44-2.38.98-.36 2.39h-2.4l-.36-2.39-2.38-.98-1.94 1.44-1.71-1.71 1.44-1.94-.98-2.38-2.39-.36v-2.4l2.39-.36.98-2.38-1.44-1.94 1.71-1.71 1.94 1.44 2.38-.98.36-2.39h2.4l.36 2.39 2.38.98 1.94-1.44 1.71 1.71-1.44 1.94z" /><circle cx="12" cy="12" r="3" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.2-1.9-.6-1.2.2-2.6 1.6-2.6H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15.5" cy="8" r="1" /></>,
  chat: <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />,
  download: <path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.5 18M12 11v9M9 17l3 3 3-3" />,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M12 15h5" /></>,
  bug: <><rect x="7" y="8" width="10" height="12" rx="5" /><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2" /></>,
  share: <><circle cx="8" cy="9" r="3" /><circle cx="17" cy="8" r="2.5" /><path d="M3 20c0-3 2.2-5 5-5s5 2 5 5M14 15.5c.9-.6 1.9-1 3-1 2.5 0 4 1.8 4 4.5" /></>
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

/** Dấu hiệu NexGraph: bốn nút đồ thị nối thành chữ N, nút Nexus ở giữa (cùng hình với biểu tượng app, design/logo). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#1b2260" />
      <g fill="none" strokeWidth="2.4">
        <path d="M8 14.5v-5" stroke="#30a8db" />
        <path d="M9.33 9l5.34 6" stroke="#8b5cf6" />
        <path d="M16 14.5v-5" stroke="#e44fc9" />
      </g>
      <g fill="none" strokeWidth="1.3">
        <circle cx="8" cy="16.5" r="2" stroke="#1fc7b6" />
        <circle cx="8" cy="7.5" r="2" stroke="#4a6cff" />
        <circle cx="16" cy="16.5" r="2" stroke="#c04df2" />
        <circle cx="16" cy="7.5" r="2" stroke="#ff4fa3" />
      </g>
      <circle cx="12" cy="12" r="1.15" fill="#fff" />
    </svg>
  )
}

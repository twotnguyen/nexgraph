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

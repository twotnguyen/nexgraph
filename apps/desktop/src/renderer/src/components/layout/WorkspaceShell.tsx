import type { CSSProperties, ReactNode } from 'react'

export interface WorkspaceShellProps {
  rail?: ReactNode
  sidebar?: ReactNode
  center: ReactNode
  dock?: ReactNode
  statusbar?: ReactNode
  children?: ReactNode
  dockSide?: 'left' | 'right'
  hidden?: boolean
  hosted?: boolean
  chatWidth?: number
}

/** Khung năm vùng: mỗi vùng là một slot, dock đổi chỗ theo bên nhưng vẫn giữ thứ tự các slot còn lại. */
export function WorkspaceShell({ rail, sidebar, center, dock, statusbar, children, dockSide = 'right', hidden = false, hosted, chatWidth }: WorkspaceShellProps) {
  const slot = (name: string, node: ReactNode) => node
    ? <div key={name} data-ws-part={name} className={`ws-part ws-part-${name}`}>{node}</div>
    : null
  return (
    <div className="workspace workspace-shell" data-hosted={hosted || undefined} data-chat-dock={dockSide}
      style={{ '--ws-chat': chatWidth === undefined ? undefined : `${chatWidth}px`, display: hidden ? 'none' : undefined } as CSSProperties}>
      {slot('rail', rail)}
      {dockSide === 'left' && slot('dock', dock)}
      {slot('sidebar', sidebar)}
      {slot('center', center)}
      {dockSide === 'right' && slot('dock', dock)}
      {slot('statusbar', statusbar)}
      {children}
    </div>
  )
}

import type { ReactNode } from 'react'

/** Vùng giữa của workbench: head, tabs, canvas và pane dưới nằm trong cùng một slot center. */
export function WorkbenchCenter({ centered = false, children }: { centered?: boolean; children: ReactNode }) {
  return (
    <section className="center" style={centered ? { maxWidth: 960, width: '100%', marginInline: 'auto' } : undefined}>
      {children}
    </section>
  )
}

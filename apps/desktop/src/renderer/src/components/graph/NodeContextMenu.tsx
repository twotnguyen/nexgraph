import { useEffect } from 'react'
import type { GraphNode } from '@nexgraph/contracts/graph-types'
import { vi } from '../../strings'

interface Props {
  node: GraphNode
  x: number
  y: number
  onFindPath: (node: GraphNode) => void
  onImpact: (node: GraphNode) => void
  onExport: (node: GraphNode) => void
  onClose: () => void
}

export function NodeContextMenu({ node, x, y, onFindPath, onImpact, onExport, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const item = (label: string, fn: (n: GraphNode) => void) => (
    <button type="button" role="menuitem" onClick={() => { fn(node); onClose() }}>{label}</button>
  )
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div role="menu" aria-label={node.label} className="context-menu" style={{ left: x, top: y }}>
        {item(vi.nodeMenu.findPath, onFindPath)}
        {item(vi.nodeMenu.impact, onImpact)}
        {item(vi.nodeMenu.export, onExport)}
      </div>
    </>
  )
}

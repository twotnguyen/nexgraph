import { useState } from 'react'
import type { GraphNode, ProjectSummary } from '@shared/graph-types'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import { NodeInspector } from '../components/graph/NodeInspector'
import { vi } from '../strings'

export function WorkspaceScreen({ project }: { project: ProjectSummary }) {
  const [selected, setSelected] = useState<GraphNode | null>(null)
  return (
    <div className="workspace">
      <aside className="sidebar">
        <b>{project.name}</b>
        <small className="muted">{project.path}</small>
      </aside>
      <section className="center">
        <div className="tabs"><button type="button" className="tab active">{vi.workspace.graphTab}</button></div>
        <div className="canvas-wrap">
          <GraphCanvas projectId={project.project_id} startNodeId=".#repository" onSelect={setSelected} />
          <NodeInspector node={selected} />
        </div>
      </section>
    </div>
  )
}

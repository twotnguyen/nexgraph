import { useState } from 'react'
import type { GraphNode, ProjectSummary } from '@shared/graph-types'
import { ActivityBar } from '../components/layout/ActivityBar'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import { NodeInspector } from '../components/graph/NodeInspector'
import { SearchPanel } from '../components/search/SearchPanel'
import { vi } from '../strings'

type Tab = 'arch' | 'graph'

const SearchIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </svg>
)

export function WorkspaceScreen({ project }: { project: ProjectSummary }) {
  const [panel, setPanel] = useState<string | null>('search')
  const [tab, setTab] = useState<Tab>('arch')
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  const openNode = (node: GraphNode) => {
    setSelected(node)
    setFocus(node.id)
    setTab('graph')
  }

  return (
    <div className="workspace">
      <ActivityBar
        items={[{ id: 'search', title: vi.activity.search, icon: SearchIcon }]}
        active={panel}
        onToggle={(id) => setPanel((cur) => (cur === id ? null : id))}
      />
      {panel === 'search' && (
        <aside className="sidebar">
          <SearchPanel projectId={project.project_id} onOpen={openNode} />
        </aside>
      )}
      <section className="center">
        <header className="ws-head">
          <b>{project.name}</b>
          <span className="muted mono">{project.path}</span>
        </header>
        <div className="tabs" role="tablist">
          {(['arch', 'graph'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'arch' ? vi.workspace.archTab : vi.workspace.graphTab}
            </button>
          ))}
        </div>
        <div className="canvas-wrap">
          {tab === 'arch' && <p className="muted placeholder">{vi.workspace.archPlaceholder}</p>}
          {tab === 'graph' && (
            <>
              <GraphCanvas projectId={project.project_id} startNodeId=".#repository" focusNodeId={focus} onSelect={setSelected} />
              <NodeInspector node={selected} />
            </>
          )}
        </div>
      </section>
    </div>
  )
}

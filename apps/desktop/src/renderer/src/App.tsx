import { useEffect, useState } from 'react'
import type { EngineStatus } from '@shared/engine-status'
import { EngineStatusBar } from './components/EngineStatusBar'

export default function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'starting' })

  useEffect(() => {
    let alive = true
    void window.nexgraph.engine.status().then((s) => alive && setStatus(s))
    const off = window.nexgraph.engine.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  return (
    <div className="app">
      <main className="app-main">
        <h1>NexGraph</h1>
        <p>Kết nối mã nguồn. Khám phá tri thức.</p>
      </main>
      <EngineStatusBar status={status} onRestart={() => void window.nexgraph.engine.restart()} />
    </div>
  )
}

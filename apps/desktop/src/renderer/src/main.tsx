import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@xyflow/react/dist/style.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles.css'

if (location.hash === '#monaco-spike') {
  void import('./spike/monaco-spike').then(async (m) => {
    const r = await m.runMonacoSpike().catch((e) => ({ error: String(e) }))
    ;(window as unknown as { __spike: unknown }).__spike = r
  })
} else createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

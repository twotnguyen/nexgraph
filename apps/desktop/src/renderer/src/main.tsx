import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initializeTheme } from './shared/lib/useTheme'
import '@xyflow/react/dist/style.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles.css'
import './styles/tab-motion.css'

initializeTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

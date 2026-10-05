import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Titillium Web, the typeface of factorio.com; it has no 500 weight, so the theme uses 600 for medium
import '@fontsource/titillium-web/300.css'
import '@fontsource/titillium-web/400.css'
import '@fontsource/titillium-web/600.css'
import '@fontsource/titillium-web/700.css'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './core/App'
import './styles.css'
import { applyTheme } from './core/theme'

applyTheme(JSON.parse(localStorage.getItem('qltc-theme') ?? 'null') ?? {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

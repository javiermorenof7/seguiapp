import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque'
import './estilos.css'
import App from './App'
import { DESARROLLO } from './entorno'

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    {import.meta.env.MODE === DESARROLLO && <div className="franja-desarrollo" role="note">Desarrollo</div>}
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
}

import { StrictMode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DidacticWindowApp } from './DidacticWindowApp'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { parseDidacticHash } from '../../shared/didactic-route'
import { bootI18n } from './i18n'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root not found')
}

function subscribeToHashChange(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/**
 * Ruteo por hash (T14, ventana didáctica desacoplada): si esta ventana carga
 * con `#didactic/<owner>/<name>/<number>` (ver
 * `src/main/windows/didactic-window.ts`, quien arma ese hash), se monta
 * `DidacticWindowApp` en vez del `<App>` de siempre.
 *
 * El hash se lee de forma REACTIVA (`hashchange`), no una sola vez al cargar
 * el módulo: cuando la ventana didáctica ya existe y `openDidacticWindow` la
 * re-navega a OTRO PR, cambiar solo el fragmento de la URL es una navegación
 * same-document — Chromium NO recarga la página, este módulo no vuelve a
 * ejecutarse, y una lectura única dejaba el contenido del PR anterior con la
 * URL del PR nuevo (bug real detectado por smoke-detach). `key={hash}`
 * remonta `DidacticWindowApp` entero al cambiar de PR: estado fresco y
 * autoload del cache del PR correcto.
 */
// eslint-disable-next-line react-refresh/only-export-components -- entrypoint sin exports: no participa de fast refresh; `Root` vive aquí porque decide qué app montar
function Root(): React.JSX.Element {
  const hash = useSyncExternalStore(subscribeToHashChange, () => window.location.hash)
  const didacticTarget = parseDidacticHash(hash)
  return didacticTarget ? <DidacticWindowApp key={hash} target={didacticTarget} /> : <App />
}

// The saved language is read before the first render so no window flashes
// English before switching to Spanish (`bootI18n` never throws).
void bootI18n().then(() => {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </StrictMode>,
  )
})

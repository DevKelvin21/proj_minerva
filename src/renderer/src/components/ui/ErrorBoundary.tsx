import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Translation } from 'react-i18next'
import { Button } from './Button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Barrera de errores global: un crash en cualquier componente muestra un
 * mensaje recuperable en vez de desmontar toda la app (pantalla en blanco).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary atrapó un error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      const message = this.state.error.message
      return (
        <Translation>
          {(t) => (
            <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-text">
              <h1 className="text-lg font-semibold">{t('errors.boundary.title')}</h1>
              <pre className="max-w-xl overflow-auto rounded-md bg-panel p-4 text-sm text-danger">
                {message}
              </pre>
              <Button variant="primary" size="md" onClick={() => this.setState({ error: null })}>
                {t('errors.boundary.retry')}
              </Button>
            </div>
          )}
        </Translation>
      )
    }
    return this.props.children
  }
}

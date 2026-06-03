import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'

type ErrorBoundaryState = {
  error: Error | null
  componentStack: string
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, componentStack: '' }
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // Keep a console trace for quick diagnosis in devtools.
    console.error('MIRA runtime error:', error)
    this.setState({ error, componentStack: info.componentStack || '' })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <h2 style={{ marginBottom: 8 }}>MIRA runtime error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.stack || this.state.error.message}</pre>
          {this.state.componentStack && (
            <>
              <h3 style={{ marginTop: 12, marginBottom: 8 }}>Component stack</h3>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.componentStack}</pre>
            </>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

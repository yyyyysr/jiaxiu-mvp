import { Component, type ErrorInfo, type ReactNode } from "react"

type ErrorBoundaryProps = { children: ReactNode; fallback?: ReactNode }
type ErrorBoundaryState = { failed: boolean }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render failed", error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback
      return (
        <main className="page-shell app-error" id="main-content" tabIndex={-1}>
          <p className="kicker">READING INTERRUPTED</p>
          <div role="alert">
            <h1>页面未能正常展开</h1>
            <p>当前页面遇到意外错误。您可以返回题咏志，继续查阅其他记录。</p>
          </div>
          <a href="/works">返回题咏志</a>
        </main>
      )
    }
    return this.props.children
  }
}

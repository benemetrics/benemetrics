import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Catches render errors from any route so a single broken screen cannot
// blank the whole app. Route state is thrown away, so recovery reloads.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[ui] render error:", error, info.componentStack ?? "");
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="screen-stack">
        <article className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Something went wrong</div>
              <div className="panel-subtitle">
                This screen hit an unexpected error. Reload to recover.
              </div>
            </div>
          </div>
          <div className="data-row">
            <div className="issue-main">
              <div className="issue-title">
                <span>UI</span>
                {this.state.error.message || "Unknown render error"}
              </div>
              <div className="issue-meta">
                If this keeps happening, check the backend connection and the browser console.
              </div>
            </div>
          </div>
          <div className="pagination">
            <span>Screen crashed</span>
            <div className="pagination-actions">
              <div
                className="pagination-button"
                role="button"
                tabIndex={0}
                onClick={() => window.location.reload()}
                onKeyDown={(event) => event.key === "Enter" && window.location.reload()}
              >
                Reload
              </div>
            </div>
          </div>
        </article>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Route-level guard: one crashing view must never blank the whole app. */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: "48px 32px", textAlign: "center" }}>
          <h2>Something went wrong loading this page.</h2>
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./App.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Dashboard ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          background: "#05080d",
          color: "#e1eaf2",
          fontFamily: "monospace",
          minHeight: "100vh"
        }}>
          <h2 style={{ color: "#ff4757" }}>⚠️ Dashboard Rendering Error</h2>
          <pre style={{
            background: "#0d1e2e",
            padding: 20,
            borderRadius: 8,
            overflow: "auto",
            color: "#f39c12"
          }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              padding: "10px 20px",
              background: "#0d3d6b",
              border: "1px solid #38c0e8",
              color: "#fff",
              borderRadius: 6,
              cursor: "pointer"
            }}
          >
            Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
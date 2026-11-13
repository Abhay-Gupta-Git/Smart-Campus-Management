import React from "react";

export default class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("CampusOS render failed:", error?.name || "Error");
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="auth">
          <section className="auth-card" role="alert" aria-live="assertive">
            <h1>This page could not be displayed</h1>
            <p>CampusOS encountered a display error. Reload the application to try again.</p>
            <button className="primary" onClick={() => window.location.reload()}>
              Reload CampusOS
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

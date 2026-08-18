import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// Instead of a silent blank page, show a reload prompt if the app ever crashes
// (e.g. a stale cached bundle talking to a newer API).
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, detail: '' };
  }
  static getDerivedStateFromError(error) {
    return { failed: true, detail: String(error && error.message ? error.message : error) };
  }
  componentDidCatch(error, info) {
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: String(error && error.message ? error.message : error),
          stack: `${error && error.stack ? error.stack : ''}\nCOMPONENT:${info && info.componentStack ? info.componentStack : ''}`,
          url: window.location.href,
        }),
      }).catch(() => {});
    } catch { /* reporting must never crash the boundary */ }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#1f2a44', textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>Something went wrong loading this page.</div>
        <div style={{ color: '#51637f', maxWidth: 420 }}>The error has been reported automatically. Reloading usually fixes it.</div>
        {this.state.detail && (
          <code style={{ color: '#f85149', fontSize: '0.75rem', maxWidth: 560, overflowWrap: 'break-word' }}>{this.state.detail}</code>
        )}
        <button className="btn primary" onClick={() => window.location.reload(true)}>Reload the portal</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

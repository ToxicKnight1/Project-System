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
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#e6edf3', textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>Something went wrong loading this page.</div>
        <div style={{ color: '#8b949e', maxWidth: 420 }}>This usually happens right after an update. Reloading fixes it.</div>
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

import React from 'react';
import ReactDOM from 'react-dom/client';
import RitualApp from './App';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

// ─── CAPGO: Signal app is alive as early as possible ────────────
// Must be called before React renders so Capgo doesn't roll back
// if the app crashes to the error boundary.
try {
  CapacitorUpdater.notifyAppReady();
  console.log('[Capgo] notifyAppReady() called at index.js startup');
} catch (e) {
  console.warn('[Capgo] notifyAppReady() failed at startup:', e);
}

// Diagnostic: confirm whether the active JS bundle is the one shipped in the
// IPA (expected when autoUpdate is false) or a Capgo cloud bundle.
(async () => {
  try {
    const { bundle } = await CapacitorUpdater.current();
    console.log('[Capgo] active bundle on startup:', bundle?.version || 'BUILTIN', 'id:', bundle?.id || 'n/a');
  } catch (_) {
    console.log('[Capgo] active bundle query failed');
  }
})();

// ─── GLOBAL ERROR CATCHERS (diagnostic — visible in iOS app switcher title) ──
window.addEventListener('error', (e) => {
  document.title = 'ERR: ' + e.message;
  console.error('GLOBAL ERROR:', e.message, e.filename, e.lineno);
});

window.addEventListener('unhandledrejection', (e) => {
  document.title = 'REJ: ' + (e.reason?.message || e.reason || 'unknown');
  console.error('UNHANDLED REJECTION:', e.reason);
});

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || String(error) };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          fontFamily: 'DM Sans, sans-serif',
          backgroundColor: '#FAF8F5',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>✦</div>
          <h1 style={{ color: '#3D4A4F', marginBottom: 16, fontSize: 24, fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p style={{ color: '#5A6B72', marginBottom: 16, maxWidth: 360, lineHeight: 1.6 }}>
            The app encountered an unexpected error. Your data is safe — try refreshing to continue.
          </p>
          {this.state.errorMessage ? (
            <p style={{ color: '#C0504D', fontSize: 12, fontFamily: 'monospace', marginBottom: 24, maxWidth: 360, wordBreak: 'break-word', background: '#FFF0EE', padding: '8px 12px', borderRadius: 8 }}>
              {this.state.errorMessage}
            </p>
          ) : null}
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: '#C17B4E',
              color: '#FAF8F5',
              border: 'none',
              padding: '12px 28px',
              borderRadius: 12,
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              fontWeight: 600,
            }}
          >
            Refresh App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ErrorBoundary><RitualApp /></ErrorBoundary>);

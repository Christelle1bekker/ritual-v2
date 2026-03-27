import React from 'react';
import ReactDOM from 'react-dom/client';
import RitualApp from './App';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary caught:', error, errorInfo);
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
          <p style={{ color: '#5A6B72', marginBottom: 32, maxWidth: 360, lineHeight: 1.6 }}>
            The app encountered an unexpected error. Your data is safe — try refreshing to continue.
          </p>
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

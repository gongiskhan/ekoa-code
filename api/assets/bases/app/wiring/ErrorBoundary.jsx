import { Component } from 'react';

/**
 * ErrorBoundary - the `app` base's shipped recoverable error UI.
 *
 * Wrap any subtree that renders fetched data. A render error is caught here
 * instead of escaping to React's default screen. The shell already mounts one
 * at the root and one around each page; add more around risky subtrees.
 *
 * Props:
 *  - children  the guarded subtree.
 *  - fallback  optional ({ error, retry }) => ReactNode to replace the default card.
 *  - onError   optional (error) => void logger.
 *
 * Note: React error boundaries only catch errors thrown during render. For an
 * async fetch, catch it in the component, put the error in state, and throw it
 * on the next render (or render your own error UI) so this boundary can show it -
 * do not swallow it silently.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (typeof this.props.onError === 'function') this.props.onError(error);
  }

  retry() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback({ error, retry: this.retry });
    }

    return (
      <div
        role="alert"
        style={{
          maxWidth: 480,
          margin: 'var(--space-8, 2rem) auto',
          padding: 'var(--space-6, 1.5rem)',
          border: '1px solid var(--color-border, #E2E8F0)',
          borderRadius: 'var(--radius-md, 0.5rem)',
          background: 'var(--color-surface, #F8FAFC)',
          textAlign: 'center',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--text-xl, 1.25rem)',
            fontWeight: 600,
            margin: 0,
            color: 'var(--color-text, #0F172A)',
          }}
        >
          Ocorreu um problema
        </h3>
        <p
          style={{
            marginTop: 'var(--space-2, 0.5rem)',
            color: 'var(--color-text-muted, #475569)',
            fontSize: 'var(--text-base, 0.9375rem)',
            lineHeight: 1.5,
          }}
        >
          {error && error.message ? error.message : 'Não foi possível carregar esta secção.'}
        </p>
        <div style={{ marginTop: 'var(--space-4, 1rem)' }}>
          <button
            type="button"
            onClick={this.retry}
            style={{
              padding: 'var(--space-2, 0.5rem) var(--space-4, 1rem)',
              background: 'var(--color-primary, #0F766E)',
              color: 'var(--color-bg, #FFFFFF)',
              border: 'none',
              borderRadius: 'var(--radius-md, 0.5rem)',
              fontWeight: 500,
              fontSize: 'var(--text-base, 0.9375rem)',
              cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
        <p style={{ marginTop: 'var(--space-3, 0.75rem)', fontSize: 'var(--text-sm, 0.8125rem)' }}>
          <a
            href="/support"
            style={{ color: 'var(--color-text-muted, #475569)', textDecoration: 'underline' }}
          >
            Reportar
          </a>
        </p>
      </div>
    );
  }
}

export default ErrorBoundary;

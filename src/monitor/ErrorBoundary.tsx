import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureException } from './core';

type Props = {
  children?: ReactNode;
  /** What to show after a render error. Default: nothing (the app's own screen is already gone). */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
};

/** Reports a render error to the monitor, then shows `fallback`. */
export class MonitorErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { componentStack: (info.componentStack ?? '').slice(0, 4000) });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children ?? null;
    const f = this.props.fallback;
    return typeof f === 'function' ? f(error, this.reset) : (f ?? null);
  }
}

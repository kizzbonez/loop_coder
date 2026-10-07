import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/Button';

interface Props {
  children: ReactNode;
  /** Changing it (e.g. on navigation) clears the error and renders the children again. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

/** Keeps a failing page from blanking the whole app: shows a message with a way out instead. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
          <TriangleAlert className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">This page ran into a problem</h2>
        <p className="mt-1 text-sm text-muted">The rest of Loop Coder still works. Try again, or reload the page if it keeps happening.</p>
        <div className="mt-5 flex gap-2">
          <Button icon={RotateCcw} onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}

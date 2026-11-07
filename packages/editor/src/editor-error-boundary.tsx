import {
  Component,
  Fragment,
  type ContextType,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { EditorLabelsContext } from "./labels";

type EditorErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type EditorErrorBoundaryState = {
  hasError: boolean;
  recoveryAttempts: number;
  recoveryKey: number;
};

const MAX_AUTO_RECOVERY_ATTEMPTS = 1;

export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  static contextType = EditorLabelsContext;
  declare context: ContextType<typeof EditorLabelsContext>;

  constructor(props: EditorErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, recoveryAttempts: 0, recoveryKey: 0 };
  }

  static getDerivedStateFromError(): Partial<EditorErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor render failed", error, info);

    if (this.state.recoveryAttempts < MAX_AUTO_RECOVERY_ATTEMPTS) {
      this.setState((state) => ({
        hasError: false,
        recoveryAttempts: state.recoveryAttempts + 1,
        recoveryKey: state.recoveryKey + 1,
      }));
    }
  }

  componentDidUpdate(prevProps: EditorErrorBoundaryProps) {
    if (prevProps.resetKey === this.props.resetKey) {
      return;
    }

    this.setState((state) => ({
      hasError: false,
      recoveryAttempts: 0,
      recoveryKey: state.recoveryKey + 1,
    }));
  }

  private retry = () => {
    this.setState((state) => ({
      hasError: false,
      recoveryAttempts: 0,
      recoveryKey: state.recoveryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="border-border bg-muted text-muted-foreground flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span>{this.context.editorFailed}</span>
          <button
            type="button"
            onClick={this.retry}
            className="border-border bg-card text-muted-foreground hover:bg-accent shrink-0 rounded-md border px-2 py-1 text-xs font-medium"
          >
            {this.context.reloadEditor}
          </button>
        </div>
      );
    }

    return (
      <Fragment key={this.state.recoveryKey}>{this.props.children}</Fragment>
    );
  }
}

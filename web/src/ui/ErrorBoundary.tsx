import { Component, type ReactNode } from 'react';

/**
 * Without this, one error while drawing any part of the page unmounts the whole app and leaves a
 * blank window. Here the window stays, says what went wrong, and offers a reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>화면을 그리다 문제가 생겼습니다</h2>
        <p className="muted">작업 중이던 내용은 서버에 그대로 있습니다. 다시 불러오면 이어서 볼 수 있습니다.</p>
        <pre>{this.state.error.message}</pre>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          다시 불러오기
        </button>
      </div>
    );
  }
}

import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AmountKeyboardProvider } from "./components/AmountInput.tsx";
import { App } from "./App.tsx";
import "./style.css";
import "./ui/pine-theme.css";
window.__ledgerStartup?.mark("main-script");
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    window.__ledgerStartup?.fail(error.name);
    console.error(error);
  }
  render() {
    return this.state.failed ? (
      <main className="boot-error">
        <h1>页面暂时无法显示</h1>
        <p>账本仍保存在本机。重新打开后可继续。</p>
        <button className="button primary" onClick={() => location.reload()}>
          重新打开
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <AmountKeyboardProvider>
      <App />
    </AmountKeyboardProvider>
  </ErrorBoundary>,
);

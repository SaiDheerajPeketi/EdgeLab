import React from "react";
import ReactDOM from "react-dom/client";
import { AppRoutes } from "./routes/AppRoutes";
import { installBrowserDiagnostics } from "./lib/browserDiagnostics";
import { applySettingsPreferences, loadSettingsPreferences } from "./lib/settingsPreferences";
import "./styles.css";

installBrowserDiagnostics();
applySettingsPreferences(loadSettingsPreferences());

// This preview marker is local to a disposable dev-browser session.
const demoPreview = (() => {
  if (!import.meta.env.DEV || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return false;
  try {
    if (new URLSearchParams(location.search).get("preview") === "demo") sessionStorage.setItem("edgelab.demo-preview", "1");
    return sessionStorage.getItem("edgelab.demo-preview") === "1";
  } catch { return new URLSearchParams(location.search).get("preview") === "demo"; }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {demoPreview && <div role="status" className="flex min-h-10 items-center justify-between gap-4 border-b border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] px-4 md:pl-24 text-sm text-[var(--text-primary)]">
      <span>Demo data</span><a href="http://localhost:5173/" className="underline underline-offset-4">Return to your workspace</a>
    </div>}
    <AppRoutes />
  </React.StrictMode>,
);

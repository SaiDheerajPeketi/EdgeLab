import React from "react";
import ReactDOM from "react-dom/client";
import { AppRoutes } from "./routes/AppRoutes";
import { installBrowserDiagnostics } from "./lib/browserDiagnostics";
import { applySettingsPreferences, loadSettingsPreferences } from "./lib/settingsPreferences";
import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";

installBrowserDiagnostics();
applySettingsPreferences(loadSettingsPreferences());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRoutes />
  </React.StrictMode>,
);

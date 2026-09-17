import React from "react";
import ReactDOM from "react-dom/client";
import { AppRoutes } from "./routes/AppRoutes";
import { installBrowserDiagnostics } from "./lib/browserDiagnostics";
import { applySettingsPreferences, loadSettingsPreferences } from "./lib/settingsPreferences";
import "./styles.css";

installBrowserDiagnostics();
applySettingsPreferences(loadSettingsPreferences());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRoutes />
  </React.StrictMode>,
);

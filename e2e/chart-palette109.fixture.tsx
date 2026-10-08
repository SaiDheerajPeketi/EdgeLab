import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChartSettingsPanel } from "../frontend/src/components/settings/ChartSettingsPanel";
import { useChartSettings } from "../frontend/src/components/settings/useChartSettings";
import { useSettingsPreferences } from "../frontend/src/components/settings/useSettingsPreferences";
import { setStoredAuthSession } from "../frontend/src/lib/authSession";
const session = (id: number) => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token: "chart109-" + id, user: { id, email: "chart109@example.test", name: "Chart tester", approved: true, betaPosition: 1, deploymentMode: "beta" as const, workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", isBetaUser: true, plan: "beta" as const, provider: "email" as const } });
setStoredAuthSession(session(10901));
declare global { interface Window { chart109: { owner(id: number): void; reload(): Promise<void>; compatibility(value: boolean): void }; } }
function Fixture() {
  const settings = useChartSettings(), preferences = useSettingsPreferences(), [compatibility, setCompatibility] = useState(false);
  window.chart109 = { owner: id => setStoredAuthSession(session(id)), reload: settings.reload, compatibility: setCompatibility };
  return <main style={{ maxWidth: 860, margin: "24px auto", padding: 24, background: "var(--ui-panel)", color: "var(--text-primary)" }}>
    <ChartSettingsPanel settings={settings} preferences={preferences} compatibility={compatibility} />
    <button type="button" style={{ position: "fixed", top: 8, right: 8, minHeight: 44 }}>Outside focus target</button>
  </main>;
}
createRoot(document.querySelector("#root")!).render(<Fixture />);

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ChartSettingsPanel } from "../settings/ChartSettingsPanel";
import { useChartSettings } from "../settings/useChartSettings";
import { useSettingsPreferences } from "../settings/useSettingsPreferences";
import { parseSettingsDeepLink } from "../settings/settingsCatalog";

export function CompatibilityChartSettings() {
  const settings = useChartSettings(), preferences = useSettingsPreferences();
  const location = useLocation();
  const appearance = location.pathname.endsWith("/appearance");
  useEffect(() => {
    const link = parseSettingsDeepLink(location.hash);
    if (!link?.controlId || !["chart", "appearance"].includes(link.category)) return;
    const element = document.getElementById(`setting-${link.controlId}`);
    element?.scrollIntoView({ block: "nearest" });
    element?.querySelector<HTMLElement>("input,select,button")?.focus();
  }, [location.hash, settings.ready, preferences.ready]);
  return <section className="min-w-0"><h1 className="text-2xl font-semibold">{appearance ? "Appearance settings" : "Chart settings"}</h1><ChartSettingsPanel appearance={appearance} compatibility settings={settings} preferences={preferences} /></section>;
}

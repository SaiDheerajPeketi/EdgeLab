import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { BacktestSettingsPanel } from "../settings/BacktestSettingsPanel";
import { useBacktestSettings } from "../settings/useBacktestSettings";
import { parseSettingsDeepLink } from "../settings/settingsCatalog";

export function CompatibilityBacktestSettings() {
  const settings = useBacktestSettings();
  const location = useLocation();
  useEffect(() => {
    const link = parseSettingsDeepLink(location.hash);
    if (link?.category !== "backtest" || !link.controlId) return;
    const element = document.getElementById(`setting-${link.controlId}`);
    element?.scrollIntoView({ block: "nearest" });
    element?.querySelector<HTMLElement>("input,select,button")?.focus();
  }, [location.hash, settings.ready]);
  return <section className="min-w-0"><h1 className="text-2xl font-semibold">Backtest settings</h1><BacktestSettingsPanel compatibility settings={settings} /></section>;
}

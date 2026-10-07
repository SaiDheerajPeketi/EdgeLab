import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SettingsDataTransfer } from "../settings/SettingsDataTransfer";
import { parseSettingsDeepLink } from "../settings/settingsCatalog";

export function CompatibilityStorageSettings() {
  const location = useLocation();
  useEffect(() => {
    const link = parseSettingsDeepLink(location.hash);
    if (link?.category !== "storage" || !link.controlId) return;
    const element = document.getElementById(`setting-${link.controlId}`);
    element?.scrollIntoView({ block: "nearest" });
    element?.focus({ preventScroll: true });
  }, [location.hash]);
  return <section className="min-w-0" data-storage-settings><h1 className="text-2xl font-semibold">Storage settings</h1><SettingsDataTransfer compatibility /></section>;
}

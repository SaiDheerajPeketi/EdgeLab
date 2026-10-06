import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AccountSettingsPanel, AiSettingsPanel, GlobalSettingsPanel, PrivacySettingsPanel } from "../settings/SessionPrivacyPanels";
import { parseSettingsDeepLink, settingsCategoryForPath } from "../settings/settingsCatalog";
import { useSettingsPreferences } from "../settings/useSettingsPreferences";

export function CompatibilitySessionPrivacySettings() {
  const location = useLocation(), preferences = useSettingsPreferences();
  const category = settingsCategoryForPath(location.pathname) ?? "global";
  useEffect(() => {
    const link = parseSettingsDeepLink(location.hash);
    if (link?.category !== category || !link.controlId) return;
    const element = document.getElementById(`setting-${link.controlId}`);
    element?.scrollIntoView({ block: "nearest" });
    (element?.querySelector<HTMLElement>("button,input,select") ?? element)?.focus({ preventScroll: true });
  }, [location.hash, category, preferences.ready]);
  const title = category === "privacy-security" ? "Privacy & security" : category === "account" ? "Account" : category === "ai" ? "AI" : "Global";
  return <section className="min-w-0" data-session-privacy-settings><h1 className="text-2xl font-semibold">{title} settings</h1>{category === "account" ? <AccountSettingsPanel compatibility /> : category === "ai" ? <AiSettingsPanel compatibility /> : category === "privacy-security" ? <PrivacySettingsPanel compatibility settings={preferences} /> : <GlobalSettingsPanel compatibility />}</section>;
}

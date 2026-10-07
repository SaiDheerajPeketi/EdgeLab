import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { getLatestBacktest } from "../../lib/api";
import { getStoredAuthSession, hasWorkspaceAccess } from "../../lib/authSession";
import { listCanonicalTrades } from "../../lib/journalApi";
import { loadAppStorageItem } from "../../lib/serverStorage";
import { hydrateSettingsPreferences, saveSettingsPreferences, type SettingsPreferences } from "../../lib/settingsPreferences";
import { buildAuthSignInHref, buildPricingHref } from "../../lib/authJourney";
import { compatibilityDeepLink, UI_COMPATIBILITY_ROUTES, type UiRouteGroup } from "../../lib/uiRollout";
const CompatibilityJournalAccounts = lazy(() => import("./CompatibilityJournal").then((module) => ({ default: module.CompatibilityJournalAccounts })));
const CompatibilityJournalTrades = lazy(() => import("./CompatibilityJournal").then((module) => ({ default: module.CompatibilityJournalTrades })));
const CompatibilityJournalNotes = lazy(() => import("./CompatibilityJournalNotes").then((module) => ({ default: module.CompatibilityJournalNotes })));
const CompatibilityJournalAnalytics = lazy(() => import("./CompatibilityJournalAnalytics").then((module) => ({ default: module.CompatibilityJournalAnalytics })));
const CompatibilityJournalDashboard = lazy(() => import("./CompatibilityJournalDashboard").then((module) => ({ default: module.CompatibilityJournalDashboard })));
const CompatibilityJournalSettings = lazy(() => import("./CompatibilityJournalSettings").then((module) => ({ default: module.CompatibilityJournalSettings })));
const CompatibilityBacktestSettings = lazy(() => import("./CompatibilityBacktestSettings").then((module) => ({ default: module.CompatibilityBacktestSettings })));
const CompatibilitySessionPrivacySettings = lazy(() => import("./CompatibilitySessionPrivacySettings").then((module) => ({ default: module.CompatibilitySessionPrivacySettings })));
const CompatibilityStorageSettings = lazy(() => import("./CompatibilityStorageSettings").then((module) => ({ default: module.CompatibilityStorageSettings })));
const CompatibilityChartSettings = lazy(() => import("./CompatibilityChartSettings").then((module) => ({ default: module.CompatibilityChartSettings })));

export function CompatibilityRouteRenderer({ group, revision }: { group: UiRouteGroup; revision: string }) {
  const location = useLocation();
  const session = getStoredAuthSession();
  const deepLink = compatibilityDeepLink(location);
  if ((location.pathname.startsWith("/app") || location.pathname === "/shared") && !hasWorkspaceAccess(session)) {
    if (session && session.user.deploymentMode !== "beta") return <Navigate replace state={{ fromPath: deepLink }} to={buildPricingHref(deepLink)} />;
    return <Navigate replace state={{ fromPath: deepLink }} to={buildAuthSignInHref({ fromPath: deepLink, waitlist: Boolean(session) })} />;
  }
  const content = location.pathname.replace(/\/$/, "") === "/app/settings/storage" ? <CompatibilityStorageSettings /> : ["/app/settings", "/app/settings/global", "/app/settings/account", "/app/settings/ai", "/app/settings/privacy-security"].includes(location.pathname.replace(/\/$/, "")) ? <CompatibilitySessionPrivacySettings /> : ["/app/settings/chart", "/app/settings/appearance"].includes(location.pathname.replace(/\/$/, "")) ? <CompatibilityChartSettings /> : location.pathname.replace(/\/$/, "") === "/app/settings/backtest" ? <CompatibilityBacktestSettings /> : ["/app/journal/settings", "/app/settings/journal"].includes(location.pathname.replace(/\/$/, "")) ? <CompatibilityJournalSettings /> : group === "public" ? <PublicCompatibility />
    : group === "settings" ? <SettingsCompatibility />
      : group === "journal" ? location.pathname.replace(/\/$/, "") === "/app/journal/dashboard" ? <CompatibilityJournalDashboard /> : location.pathname.replace(/\/$/, "") === "/app/journal/accounts" ? <CompatibilityJournalAccounts /> : location.pathname.replace(/\/$/, "") === "/app/journal/trades" ? <CompatibilityJournalTrades /> : ["/app/journal/notes", "/app/journal/calendar"].includes(location.pathname.replace(/\/$/, "")) ? <CompatibilityJournalNotes calendarMode={location.pathname.replace(/\/$/, "") === "/app/journal/calendar"} /> : ["/app/journal/analytics", "/app/journal/reports"].includes(location.pathname.replace(/\/$/, "")) ? <CompatibilityJournalAnalytics /> : <JournalCompatibility />
        : group === "chart" ? <ChartCompatibility />
          : <ShellCompatibility email={session?.user.email ?? "Approved user"} />;
  return (
    <div className="min-h-screen bg-[#11100d] text-stone-100" data-compatibility-renderer={group}>
      <header className="border-b-2 border-amber-700 bg-[#221d14] shadow-md">
        <div className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
          <strong className="font-mono text-sm tracking-wide text-amber-200">EdgeLab compatibility</strong>
          <nav aria-label={`${group} compatibility navigation`} className={`flex flex-wrap items-center gap-1 ${group === "journal" ? "w-full flex-none sm:w-auto sm:flex-1" : "flex-1"}`}>
            {UI_COMPATIBILITY_ROUTES[group].map((item) => <Link className="inline-flex min-h-11 items-center border border-stone-600 bg-stone-900 px-3 text-sm font-medium hover:border-amber-400" key={item.href} to={item.href}>{item.label}</Link>)}
          </nav>
          <span className="font-mono text-[11px] text-stone-400">policy {revision}</span>
        </div>
        <p aria-atomic="true" className="border-t border-amber-800/70 bg-amber-950 px-4 py-1.5 text-xs text-amber-100" role="status">Compatibility interface active for {group}. Current deep link: <bdi>{deepLink}</bdi></p>
      </header>
      <main className="mx-auto max-w-5xl p-5" id="compatibility-content"><Suspense fallback={<p role="status">Loading this workspace…</p>}>{content}</Suspense></main>
    </div>
  );
}

function PublicCompatibility() {
  return <section><p className="text-xs uppercase tracking-widest text-amber-300">Pre-redesign public interface</p><h1 className="mt-2 text-3xl font-semibold">Trade replay without losing your work</h1><p className="mt-3 max-w-2xl text-stone-300">Open pricing or sign in. Rollback changes presentation only; account and workspace data remain on the same services.</p><Link className="mt-5 inline-flex min-h-11 items-center border border-amber-500 px-4" to="/auth/signin">Sign in to EdgeLab</Link></section>;
}

function ShellCompatibility({ email }: { email: string }) {
  return <section><p className="text-xs uppercase tracking-widest text-amber-300">Pre-redesign workspace</p><h1 className="mt-2 text-2xl font-semibold">Workspace home</h1><p className="mt-3 text-stone-300">Session restored for <bdi>{email}</bdi>. Choose a core workspace above; no document or account migration runs in compatibility mode.</p></section>;
}

function JournalCompatibility() {
  const [state, setState] = useState("Loading journal…");
  const refresh = () => { setState("Loading journal…"); void listCanonicalTrades({ limit: 20 }).then((trades) => setState(`${trades.length} recent trades available`)).catch(() => setState("Journal is temporarily unavailable")); };
  useEffect(refresh, []);
  return <section><p className="text-xs uppercase tracking-widest text-amber-300">Pre-redesign journal</p><h1 className="mt-2 text-2xl font-semibold">Journal</h1><p className="mt-3 text-stone-300" role="status">{state}</p><button className="mt-5 min-h-11 border border-stone-500 px-4" onClick={refresh} type="button">Refresh journal</button></section>;
}

function ChartCompatibility() {
  const [replay, setReplay] = useState("Loading active replay…");
  const [layout, setLayout] = useState("Loading chart layout…");
  useEffect(() => {
    void getLatestBacktest().then((value) => setReplay(`${value.session.name} · ${value.session.symbol}`)).catch(() => setReplay("No active replay"));
    void loadAppStorageItem<unknown>("active-live-chart-layout.v1", null).then((value) => setLayout(typeof value === "string" && value ? value : "Default chart layout"));
  }, []);
  return <section><p className="text-xs uppercase tracking-widest text-amber-300">Pre-redesign chart tools</p><h1 className="mt-2 text-2xl font-semibold">Chart and replay</h1><dl className="mt-4 grid gap-3 sm:grid-cols-2"><div className="border border-stone-700 p-3"><dt className="text-xs text-stone-400">Active replay</dt><dd className="mt-1" data-compatibility-replay>{replay}</dd></div><div className="border border-stone-700 p-3"><dt className="text-xs text-stone-400">Saved chart context</dt><dd className="mt-1" data-compatibility-chart>{layout}</dd></div></dl></section>;
}

function SettingsCompatibility() {
  const [preferences, setPreferences] = useState<SettingsPreferences | null>(null);
  const [status, setStatus] = useState("Loading settings…");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const save = async () => {
    if (!preferences || saving) return;
    setSaving(true);
    setSaveFailed(false);
    setStatus("Saving settings…");
    try {
      await saveSettingsPreferences(preferences, { requireServerPersistence: true });
      sessionStorage.removeItem("edgelab.compatibility.settings-draft.v1");
      setStatus("Settings saved");
    } catch {
      setSaveFailed(true);
      setStatus("Settings could not be saved. Your changes are kept; try again.");
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => { void hydrateSettingsPreferences().then((value) => {
    const draft = readSettingsDraft();
    setPreferences(draft ?? value);
    setStatus(draft ? "Unsaved changes" : "Settings loaded");
  }).catch(() => setStatus("Settings unavailable")); }, []);
  if (!preferences) return <section><h1 className="text-2xl font-semibold">Settings</h1><p className="mt-3" role="status">{status}</p></section>;
  return <section><p className="text-xs uppercase tracking-widest text-amber-300">Pre-redesign settings</p><h1 className="mt-2 text-2xl font-semibold">Settings</h1><label className="mt-5 block max-w-sm text-sm">Workspace density<select className="mt-2 min-h-11 w-full border border-stone-600 bg-stone-900 px-3" disabled={saving} onChange={(event) => { const next = { ...preferences, density: event.target.value === "compact" ? "compact" : "comfortable" } satisfies SettingsPreferences; setPreferences(next); sessionStorage.setItem("edgelab.compatibility.settings-draft.v1", JSON.stringify(next)); setSaveFailed(false); setStatus("Unsaved changes"); }} value={preferences.density}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button className="mt-4 min-h-11 border border-amber-500 px-4" disabled={saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save settings"}</button><p className="mt-3 text-sm text-stone-300" role={saveFailed ? "alert" : "status"}>{status}</p></section>;
}

function readSettingsDraft(): SettingsPreferences | null {
  try {
    const value = JSON.parse(sessionStorage.getItem("edgelab.compatibility.settings-draft.v1") ?? "null") as Partial<SettingsPreferences> | null;
    if (!value) return null;
    return { density: value.density === "compact" ? "compact" : "comfortable", includeDiagnosticsByDefault: value.includeDiagnosticsByDefault !== false };
  } catch { return null; }
}

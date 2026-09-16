import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Database, Link2, LoaderCircle, Plus, RefreshCw, Unplug } from "lucide-react";
import {
  createBrokerConnection,
  createIntegrationSecret,
  getBrokerConnections,
  getBrokerProviders,
  refreshBrokerConnection,
  revokeBrokerConnection,
  verifyIntegrationSecret,
  type BrokerConnection,
  type BrokerProvider,
} from "../../lib/api";
import { listBrokerDiscoveredAccounts, type BrokerDiscoveredAccount, type CanonicalTrade, type JournalAccount, type JournalAccountCreate, type JournalImportCreate, type JournalImportRun } from "../../lib/journalApi";
import { summarizeJournalTrades } from "../../lib/journalAnalytics";
import { humanizeProductStatus } from "../../lib/productLanguage";
import { JournalButton, journalFieldClass } from "./JournalControls";
import { JournalImportFlow } from "./JournalImportFlow";

export function JournalAccountsSurface({ accounts, trades, imports, onAddAccount, onImport, onRollback, onSyncConnection }: { accounts: JournalAccount[]; trades: CanonicalTrade[]; imports: JournalImportRun[]; onAddAccount: (payload: JournalAccountCreate) => Promise<JournalAccount>; onImport: (payload: JournalImportCreate) => Promise<{ run: JournalImportRun }>; onRollback: (runId: number) => Promise<unknown>; onSyncConnection: (connectionId: number) => Promise<unknown> }) {
  const [providers, setProviders] = useState<BrokerProvider[]>([]);
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [discovered, setDiscovered] = useState<Record<number, BrokerDiscoveredAccount[]>>({});
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [connectionName, setConnectionName] = useState("Offline fixture");
  const [busy, setBusy] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [accountDraft, setAccountDraft] = useState({ name: "", provider: "Manual", currency: "USD", timezone: "UTC", initialBalance: "0", color: "#67e8f9", notes: "" });

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true); setConnectionError(null);
    try {
      const [nextProviders, nextConnections] = await Promise.all([getBrokerProviders(), getBrokerConnections()]);
      setProviders(nextProviders); setConnections(nextConnections);
      const discoveredEntries = await Promise.all(nextConnections.filter((connection) => !connection.revoked_at).map(async (connection) => [connection.id, await listBrokerDiscoveredAccounts(connection.id)] as const));
      setDiscovered(Object.fromEntries(discoveredEntries));
    } catch (caught) { setConnectionError(caught instanceof Error ? caught.message : "Provider status could not be loaded."); }
    finally { setLoadingConnections(false); }
  }, []);

  useEffect(() => {
    void loadConnections();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void loadConnections(); }, 60_000);
    return () => window.clearInterval(poll);
  }, [loadConnections]);

  async function connectProvider() {
    if (!selectedProvider || !token.trim() || !connectionName.trim()) return;
    setBusy("connect"); setConnectionError(null);
    try {
      const credentialKey = selectedProvider === "offline-fixture" ? "fixture_token" : selectedProvider === "ninjatrader" ? "api_key" : "access_token";
      const secret = await createIntegrationSecret({ provider: selectedProvider, purpose: "broker-sync", credentials: { [credentialKey]: token } });
      await verifyIntegrationSecret(secret.id);
      const connection = await createBrokerConnection({ provider: selectedProvider, display_name: connectionName.trim(), secret_id: secret.id });
      await refreshBrokerConnection(connection.id);
      await onSyncConnection(connection.id);
      setToken(""); setSelectedProvider(null); await loadConnections();
    } catch (caught) { setConnectionError(caught instanceof Error ? caught.message : "The connection could not be created."); }
    finally { setBusy(null); }
  }

  async function refresh(connection: BrokerConnection) {
    setBusy(`refresh-${connection.id}`); setConnectionError(null);
    try { await refreshBrokerConnection(connection.id); await onSyncConnection(connection.id); await loadConnections(); }
    catch (caught) { setConnectionError(caught instanceof Error ? caught.message : "Refresh failed. Review the provider error and retry."); }
    finally { setBusy(null); }
  }

  async function addDiscovered(connection: BrokerConnection, account: BrokerDiscoveredAccount) {
    setBusy(`account-${account.id}`);
    try { await onAddAccount({ name: account.display_name, provider: connection.display_name, currency: account.currency, timezone: "UTC", initial_balance: 0, broker_account_id: account.id }); }
    catch (caught) { setConnectionError(caught instanceof Error ? caught.message : "The discovered account could not be added."); }
    finally { setBusy(null); }
  }

  async function addManual() {
    if (!accountDraft.name.trim() || !accountDraft.timezone.trim() || !accountDraft.currency.trim()) return;
    setBusy("manual"); setConnectionError(null);
    try { await onAddAccount({ name: accountDraft.name.trim(), provider: accountDraft.provider.trim() || "Manual", currency: accountDraft.currency.trim().toUpperCase(), timezone: accountDraft.timezone.trim(), initial_balance: Number(accountDraft.initialBalance) || 0, color: accountDraft.color, notes: accountDraft.notes.trim() || null }); setManualOpen(false); setAccountDraft({ name: "", provider: "Manual", currency: "USD", timezone: "UTC", initialBalance: "0", color: "#67e8f9", notes: "" }); }
    catch (caught) { setConnectionError(caught instanceof Error ? caught.message : "Account could not be created."); }
    finally { setBusy(null); }
  }

  const providerGroups = useMemo(() => [
    { id: "crypto", label: "Crypto", providers: providers.filter((provider) => /binance|coin|crypto/i.test(`${provider.provider_id} ${provider.display_name}`)) },
    { id: "stocks", label: "Stocks & options", providers: providers.filter((provider) => /ibkr|alpaca|stock|option/i.test(`${provider.provider_id} ${provider.display_name}`)) },
    { id: "futures", label: "Futures", providers: providers.filter((provider) => /tradovate|ninja|future/i.test(`${provider.provider_id} ${provider.display_name}`)) },
    { id: "other", label: "Other / test", providers: providers.filter((provider) => !/binance|coin|crypto|ibkr|alpaca|stock|option|tradovate|ninja|future/i.test(`${provider.provider_id} ${provider.display_name}`)) },
  ], [providers]);

  return <div className="space-y-8">
    <section aria-labelledby="journal-accounts-heading"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 id="journal-accounts-heading" className="text-xl font-semibold text-white">Accounts</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Each account owns a currency, time zone, trades, imports, and provider linkage. Cross-currency totals stay separated.</p></div><JournalButton onClick={() => setManualOpen((value) => !value)}><Plus aria-hidden="true" className="h-4 w-4" />Add manual account</JournalButton></div>
      {connectionError ? <p role="alert" className="mt-4 flex gap-2 rounded-md bg-rose-400/10 px-3 py-2 text-sm text-rose-100"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{connectionError}</p> : null}
      {manualOpen ? <form className="mt-4 border-y border-white/10 bg-white/[0.015] p-4" onSubmit={(event) => { event.preventDefault(); void addManual(); }}><p className="mb-4 text-sm font-semibold text-white">Manual account</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Account name" value={accountDraft.name} onChange={(name) => setAccountDraft((current) => ({ ...current, name }))} /><Field label="Broker label" value={accountDraft.provider} onChange={(provider) => setAccountDraft((current) => ({ ...current, provider }))} /><Field label="Currency" value={accountDraft.currency} onChange={(currency) => setAccountDraft((current) => ({ ...current, currency: currency.toUpperCase() }))} /><Field label="Time zone" value={accountDraft.timezone} onChange={(timezone) => setAccountDraft((current) => ({ ...current, timezone }))} /><Field label="Initial balance" value={accountDraft.initialBalance} onChange={(initialBalance) => setAccountDraft((current) => ({ ...current, initialBalance }))} inputMode="decimal" /><label className="text-xs text-slate-500">Color<input type="color" value={accountDraft.color} onChange={(event) => setAccountDraft((current) => ({ ...current, color: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0a0d11] p-1" /></label><label className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">Notes<textarea value={accountDraft.notes} onChange={(event) => setAccountDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className={`${journalFieldClass} mt-1 resize-y py-2`} /></label></div><div className="mt-4 flex justify-end gap-2"><JournalButton onClick={() => setManualOpen(false)}>Cancel</JournalButton><JournalButton type="submit" tone="primary" disabled={!accountDraft.name.trim() || busy === "manual"}>{busy === "manual" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus aria-hidden="true" className="h-4 w-4" />}Create account</JournalButton></div></form> : null}
      <div className="mt-5 divide-y divide-white/8 border-y border-white/10">{accounts.map((account) => { const summary = summarizeJournalTrades(trades.filter((trade) => trade.account_id === account.id)); return <div key={account.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(5rem,auto))]"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-semibold text-white"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: account.color ?? "#71717a" }} />{account.name}</p><p className="mt-1 text-xs text-slate-500">{account.provider} · {account.currency} · {account.timezone} · {account.source_type.toLowerCase()}</p></div><AccountStat label="Trades" value={summary.totalTrades.toLocaleString()} /><AccountStat label="Net" value={money(summary.netPnl, account.currency)} tone={summary.netPnl} /><AccountStat label="Win rate" value={`${summary.winRate.toFixed(1)}%`} /><AccountStat label="Costs" value={money(summary.costs, account.currency)} /></div>; })}{!accounts.length ? <div className="py-8 text-center"><p className="text-sm font-medium text-slate-200">No Journal account yet</p><p className="mt-1 text-sm text-slate-500">Create one, import sample trades, or connect a supported provider.</p></div> : null}</div>
    </section>

    <section aria-labelledby="provider-catalog-heading" className="border-t border-white/10 pt-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="provider-catalog-heading" className="text-base font-semibold text-white">Provider catalog</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Catalog capabilities come from the server. Planned adapters cannot be connected. Status refreshes every minute while this page is visible.</p></div><JournalButton onClick={() => void loadConnections()} disabled={loadingConnections}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loadingConnections ? "animate-spin motion-reduce:animate-none" : ""}`} />Refresh status</JournalButton></div>
      <div className="mt-4 divide-y divide-white/8 border-y border-white/10">{providerGroups.map((group) => <div key={group.id} className="grid gap-3 py-4 lg:grid-cols-[10rem_minmax(0,1fr)]"><h3 className="text-sm font-medium text-slate-300">{group.label}</h3><div className="space-y-3">{group.providers.length ? group.providers.map((provider) => <div key={provider.provider_id} className="rounded-md border border-white/10 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{provider.display_name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{provider.description}</p></div><span className={`text-xs ${provider.availability === "available" ? "text-emerald-300" : provider.availability === "offline-fixture" ? "text-cyan-300" : "text-amber-200"}`}>{provider.availability === "available" ? "Available" : provider.availability === "offline-fixture" ? "Offline test adapter" : provider.availability === "unconfigured" ? "Server setup required" : "Planned"}</span></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>Accounts {yesNo(provider.capabilities.accounts)}</span><span>Orders {yesNo(provider.capabilities.orders)}</span><span>Fills {yesNo(provider.capabilities.fills)}</span><span>Incremental {yesNo(provider.capabilities.incremental_sync)}</span><span>Live {yesNo(provider.capabilities.live_connectivity)}</span></div>{provider.availability === "available" || provider.availability === "offline-fixture" ? <button type="button" onClick={() => { setSelectedProvider(provider.provider_id); setConnectionName(provider.display_name); }} className="mt-3 min-h-9 text-xs font-semibold text-cyan-300 hover:underline">Configure connection</button> : null}</div>) : <p className="py-3 text-sm text-slate-600">No supported connector in this build.</p>}</div></div>)}</div>
      {selectedProvider ? <form onSubmit={(event) => { event.preventDefault(); void connectProvider(); }} className="mt-4 border-y border-cyan-300/20 bg-cyan-300/[0.025] p-4"><p className="text-sm font-semibold text-white">Connect {providers.find((provider) => provider.provider_id === selectedProvider)?.display_name}</p><p className="mt-1 text-xs leading-5 text-slate-500">The credential is encrypted server-side and never returned. Initial refresh tests connectivity, discovers accounts, advances the provider cursor, and reconciles normalized fills.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Connection name" value={connectionName} onChange={setConnectionName} /><label className="text-xs text-slate-500">{selectedProvider === "offline-fixture" ? "Fixture token" : selectedProvider === "ninjatrader" ? "API key" : "Access token"}<input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} className={`${journalFieldClass} mt-1`} /></label></div><div className="mt-4 flex justify-end gap-2"><JournalButton onClick={() => { setSelectedProvider(null); setToken(""); }}>Cancel</JournalButton><JournalButton type="submit" tone="primary" disabled={!token.trim() || !connectionName.trim() || busy === "connect"}>{busy === "connect" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Link2 aria-hidden="true" className="h-4 w-4" />}Connect and sync</JournalButton></div></form> : null}
      <div className="mt-5 space-y-3">{connections.filter((connection) => !connection.revoked_at).map((connection) => <div key={connection.id} className="border-y border-white/10 px-1 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold text-white"><Database aria-hidden="true" className="h-4 w-4 text-cyan-300" />{connection.display_name}</p><p className="mt-1 text-xs text-slate-500">{connection.provider} · {humanizeProductStatus(connection.status)} · health {humanizeProductStatus(connection.health)} · last sync {connection.last_sync_completed_at ? new Date(connection.last_sync_completed_at).toLocaleString() : "never"}</p>{connection.last_error_message ? <p className="mt-2 text-xs text-rose-200">{connection.last_error_message} {connection.next_retry_at ? `Next retry ${new Date(connection.next_retry_at).toLocaleString()}.` : "Refresh after resolving the provider issue."}</p> : null}</div><div className="flex gap-2"><JournalButton onClick={() => void refresh(connection)} disabled={busy != null}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy === `refresh-${connection.id}` ? "animate-spin motion-reduce:animate-none" : ""}`} />Refresh</JournalButton><JournalButton tone="danger" disabled={busy != null} onClick={() => { if (!window.confirm("Disconnect this provider? Imported Journal trades remain.")) return; setBusy(`revoke-${connection.id}`); void revokeBrokerConnection(connection.id).then(loadConnections).catch((caught) => setConnectionError(caught instanceof Error ? caught.message : "Disconnect failed.")).finally(() => setBusy(null)); }}><Unplug aria-hidden="true" className="h-4 w-4" />Disconnect</JournalButton></div></div>{(discovered[connection.id] ?? []).length ? <div className="mt-3"><p className="text-xs font-medium text-slate-500">Discovered accounts</p><div className="mt-2 divide-y divide-white/8">{discovered[connection.id].map((brokerAccount) => { const linked = accounts.some((account) => account.broker_account_id === brokerAccount.id); return <div key={brokerAccount.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate text-slate-300">{brokerAccount.display_name} · {brokerAccount.currency} · {humanizeProductStatus(brokerAccount.status)}</span>{linked ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check aria-hidden="true" className="h-3.5 w-3.5" />Added</span> : <button type="button" onClick={() => void addDiscovered(connection, brokerAccount)} disabled={busy != null} className="min-h-8 shrink-0 text-xs font-semibold text-cyan-300 hover:underline">Add to Journal</button>}</div>; })}</div></div> : null}</div>)}{!connections.length && !loadingConnections ? <p className="py-4 text-sm text-slate-500">No provider connections. CSV and manual entry remain fully available.</p> : null}</div>
    </section>

    <JournalImportFlow accounts={accounts} imports={imports} onImport={onImport} onRollback={onRollback} />
  </div>;
}

function Field({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal" }) { return <label className="text-xs text-slate-500">{label}<input value={value} onChange={(event) => onChange(event.target.value)} inputMode={inputMode} className={`${journalFieldClass} mt-1`} /></label>; }
function AccountStat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <dl className="sm:text-right"><dt className="text-[11px] text-slate-600">{label}</dt><dd className={`mt-1 text-sm font-medium tabular-nums ${tone == null ? "text-slate-200" : tone >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{value}</dd></dl>; }
function yesNo(value: boolean) { return value ? "supported" : "unavailable"; }
function money(value: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }

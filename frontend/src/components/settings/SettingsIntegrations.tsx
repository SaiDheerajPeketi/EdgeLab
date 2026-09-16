import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Database, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  createBrokerConnection,
  createIntegrationSecret,
  getBrokerConnections,
  getBrokerProviders,
  getIntegrationSecrets,
  refreshBrokerConnection,
  revokeBrokerConnection,
  revokeIntegrationSecret,
  rotateIntegrationSecret,
  verifyIntegrationSecret,
  type BrokerConnection,
  type BrokerProvider,
  type IntegrationSecret,
} from "../../lib/api";
import { SettingRow, SettingsSection, fieldClassName } from "./SettingsPrimitives";

type LoadState = "loading" | "ready" | "error";

export function SettingsIntegrations() {
  const [providers, setProviders] = useState<BrokerProvider[]>([]);
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [secrets, setSecrets] = useState<IntegrationSecret[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("offline-fixture");
  const [connectionName, setConnectionName] = useState("Offline fixture");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const [nextProviders, nextConnections, nextSecrets] = await Promise.all([
        getBrokerProviders(),
        getBrokerConnections(),
        getIntegrationSecrets(),
      ]);
      setProviders(nextProviders);
      setConnections(nextConnections);
      setSecrets(nextSecrets);
      setLoadState("ready");
    } catch (caught) {
      setError(messageFor(caught, "Connection status is unavailable. Check your session and retry."));
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeSecrets = useMemo(() => secrets.filter((secret) => secret.state === "active"), [secrets]);

  async function addConnection() {
    if (!credential.trim() || !connectionName.trim()) return;
    setBusy("create");
    setError(null);
    try {
      const credentialKey = selectedProvider === "offline-fixture" ? "fixture_token" : selectedProvider === "ninjatrader" ? "api_key" : "access_token";
      const secret = await createIntegrationSecret({
        provider: selectedProvider,
        purpose: "broker-sync",
        credentials: { [credentialKey]: credential },
      });
      await verifyIntegrationSecret(secret.id);
      await createBrokerConnection({
        provider: selectedProvider,
        display_name: connectionName.trim(),
        secret_id: secret.id,
      });
      setCredential("");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "The broker connection could not be created. Verify the credential and provider configuration, then retry."));
    } finally {
      setBusy(null);
    }
  }

  async function run(actionKey: string, action: () => Promise<unknown>) {
    setBusy(actionKey);
    setError(null);
    try {
      await action();
      setConfirmAction(null);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "The connection action failed. Retry after reviewing its status."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection title="Providers and credentials" description="Status comes from EdgeLab’s authenticated provider and vault APIs. Credential values are write-only and never displayed again.">
      <SettingRow controlId="broker-connections" label="Broker connections" description="Review capabilities before connecting. Planned adapters remain unavailable until a live integration exists." scope="Personal" validation={error}>
        <div className="space-y-3">
          {loadState === "loading" ? <p className="flex items-center gap-2 text-sm text-zinc-400" role="status"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />Loading provider status…</p> : null}
          {loadState === "error" ? <button type="button" onClick={() => void load()} className="min-h-9 text-sm font-semibold text-cyan-300 hover:underline">Retry status check</button> : null}
          {providers.map((provider) => (
            <div key={provider.provider_id} className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{provider.display_name}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{provider.description}</p>
                </div>
                <span className="text-xs text-zinc-400">{provider.availability === "available" ? "Available" : provider.availability === "offline-fixture" ? "Local test environment" : provider.availability === "unconfigured" ? "Server setup required" : "Planned — unavailable"}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
                <Capability label="Accounts" enabled={provider.capabilities.accounts} />
                <Capability label="Orders" enabled={provider.capabilities.orders} />
                <Capability label="Fills" enabled={provider.capabilities.fills} />
                <Capability label="Incremental sync" enabled={provider.capabilities.incremental_sync} />
                <Capability label="Live connectivity" enabled={provider.capabilities.live_connectivity} />
                <div><dt className="text-zinc-600">Permissions</dt><dd className="text-zinc-300">{provider.requires_secret ? "Credential required" : "None"}</dd></div>
              </dl>
            </div>
          ))}

          {providers.some((provider) => provider.availability === "available" || provider.availability === "offline-fixture") ? (
            <form className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.03] p-3" onSubmit={(event) => { event.preventDefault(); void addConnection(); }}>
              <p className="text-sm font-medium text-zinc-100">Create broker connection</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Credentials are encrypted server-side and never returned. The first refresh verifies provider connectivity and discovers accounts.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-medium text-zinc-300">Provider<select value={selectedProvider} onChange={(event) => { setSelectedProvider(event.target.value); setConnectionName(providers.find((provider) => provider.provider_id === event.target.value)?.display_name ?? "Broker"); }} className={`${fieldClassName} mt-1`}>{providers.filter((provider) => provider.availability === "available" || provider.availability === "offline-fixture").map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.display_name}</option>)}</select></label>
                <label className="text-xs font-medium text-zinc-300">Connection name<input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} maxLength={120} className={`${fieldClassName} mt-1`} /></label>
                <label className="text-xs font-medium text-zinc-300 sm:col-span-2">{selectedProvider === "offline-fixture" ? "Fixture token" : selectedProvider === "ninjatrader" ? "API key" : "Access token"}<input value={credential} onChange={(event) => setCredential(event.target.value)} type="password" autoComplete="new-password" className={`${fieldClassName} mt-1`} /></label>
              </div>
              <button type="submit" disabled={!credential.trim() || !connectionName.trim() || busy === "create"} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-45">
                {busy === "create" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Database aria-hidden="true" className="h-4 w-4" />}
                Save credential and create connection
              </button>
            </form>
          ) : null}

          {connections.length ? <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Configured connections</p>{connections.map((connection) => (
            <div key={connection.id} aria-label={`${connection.display_name} connection`} className="rounded-md border border-white/10 p-3" role="group">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{connection.display_name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{connection.provider} · {connection.status} · health {connection.health.toLowerCase()}</p>
                  <p className="mt-1 text-xs text-zinc-500">Last sync: {connection.last_sync_completed_at ? formatDate(connection.last_sync_completed_at) : "Never"} · Latency: not measured</p>
                  {connection.last_error_message ? <p className="mt-2 flex gap-1.5 text-xs text-rose-300"><AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />{connection.last_error_message}</p> : null}
                </div>
                {connection.revoked_at ? <span className="text-xs text-zinc-500">Revoked {formatDate(connection.revoked_at)}</span> : (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void run(`refresh-${connection.id}`, () => refreshBrokerConnection(connection.id))} disabled={busy != null} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs font-medium text-zinc-200 hover:bg-white/5 disabled:opacity-45 sm:min-h-9"><RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${busy === `refresh-${connection.id}` ? "animate-spin motion-reduce:animate-none" : ""}`} />Refresh</button>
                    <button type="button" onClick={() => setConfirmAction(`connection-${connection.id}`)} disabled={busy != null} className="min-h-11 rounded-md px-2.5 text-xs font-medium text-rose-300 hover:bg-rose-400/10 disabled:opacity-45 sm:min-h-9">Revoke</button>
                  </div>
                )}
              </div>
              {confirmAction === `connection-${connection.id}` ? <ConfirmDanger message="This stops future refreshes. Imported journal data remains." busy={busy === `revoke-connection-${connection.id}`} onCancel={() => setConfirmAction(null)} onConfirm={() => void run(`revoke-connection-${connection.id}`, () => revokeBrokerConnection(connection.id))} /> : null}
            </div>
          ))}</div> : null}
        </div>
      </SettingRow>

      <SettingRow controlId="credential-vault" label="Credential vault" description="Inspect metadata, test decryptability, re-encrypt with the active vault key, or revoke access." effective={`${activeSecrets.length} active credential record${activeSecrets.length === 1 ? "" : "s"}`} scope="Personal">
        <div className="space-y-2">
          {secrets.length === 0 && loadState === "ready" ? <p className="text-sm text-zinc-500">No credential records.</p> : null}
          {secrets.map((secret) => (
            <div key={secret.id} className="rounded-md border border-white/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-zinc-100"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-cyan-300" />{secret.provider}</p>
                  <p className="mt-1 text-xs text-zinc-500">{secret.purpose} · v{secret.version} · key {secret.key_id} · {secret.state}</p>
                  <p className="mt-1 text-xs text-zinc-600">Last readiness check: {secret.last_connected_at ? formatDate(secret.last_connected_at) : "Never"}</p>
                </div>
                {secret.state === "active" ? <div className="flex flex-wrap justify-end gap-1.5">
                  <button type="button" disabled={busy != null} onClick={() => void run(`verify-${secret.id}`, () => verifyIntegrationSecret(secret.id))} className="min-h-8 rounded px-2 text-xs text-zinc-300 hover:bg-white/5">Verify</button>
                  <button type="button" disabled={busy != null} onClick={() => void run(`rotate-${secret.id}`, () => rotateIntegrationSecret(secret.id))} className="min-h-8 rounded px-2 text-xs text-zinc-300 hover:bg-white/5">Re-encrypt</button>
                  <button type="button" disabled={busy != null} onClick={() => setConfirmAction(`secret-${secret.id}`)} className="grid h-8 w-8 place-items-center rounded text-rose-300 hover:bg-rose-400/10" aria-label={`Revoke ${secret.provider} credential`}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
                </div> : null}
              </div>
              {confirmAction === `secret-${secret.id}` ? <ConfirmDanger message="Connections using this credential will no longer be able to decrypt it." busy={busy === `revoke-secret-${secret.id}`} onCancel={() => setConfirmAction(null)} onConfirm={() => void run(`revoke-secret-${secret.id}`, () => revokeIntegrationSecret(secret.id))} /> : null}
            </div>
          ))}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <div><dt className="text-zinc-600">{label}</dt><dd className={enabled ? "text-emerald-300" : "text-zinc-500"}>{enabled ? "Supported" : "Unavailable"}</dd></div>;
}

function ConfirmDanger({ message, busy, onCancel, onConfirm }: { message: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div aria-label="Confirm revocation" className="mt-3 border-t border-rose-400/20 pt-3" role="region"><p className="text-xs leading-5 text-rose-200">{message} This action is recorded by the service.</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded px-3 text-xs text-white/80 hover:bg-white/5 sm:min-h-9">Cancel</button><button type="button" onClick={onConfirm} disabled={busy} className="inline-flex min-h-11 items-center gap-1.5 rounded bg-rose-500 px-3 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-45 sm:min-h-9">{busy ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />}Confirm revoke</button></div></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

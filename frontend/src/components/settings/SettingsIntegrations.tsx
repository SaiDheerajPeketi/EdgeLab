import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ThemedSelect } from "../ThemedSelect";
import { assertAppDataAccess, captureAppDataAccess } from "../../lib/appDataBarrier";
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
  const [selectedProvider, setSelectedProvider] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const [setup, setSetup] = useState<{ provider: string; name: string; secretId: IntegrationSecret["id"]; verified: boolean } | null>(null);
  const operation = useRef<string | null>(null);
  const selected = useRef(selectedProvider);
  selected.current = selectedProvider;
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const access = captureAppDataAccess();
    setLoadState("loading");
    setError(null);
    try {
      const [nextProviders, nextConnections, nextSecrets] = await Promise.all([
        getBrokerProviders(),
        getBrokerConnections(),
        getIntegrationSecrets(),
      ]);
      if (![nextProviders, nextConnections, nextSecrets].every(Array.isArray)) {
        throw new Error("Connection status returned an invalid response. Retry the status check.");
      }
      assertAppDataAccess(access);
      if (version !== loadVersion.current) return;
      const implemented = nextProviders.filter(provider => ["available", "unconfigured", "offline-fixture"].includes(provider.availability));
      const connectable = implemented.filter(provider => provider.availability === "available" || provider.availability === "offline-fixture");
      if (!connectable.some(provider => provider.provider_id === selected.current)) {
        const first = connectable.find(provider => provider.availability === "available") ?? connectable[0];
        setSelectedProvider(first?.provider_id ?? "");
        setConnectionName(first?.display_name ?? "");
        setCredential("");
      }
      setProviders(implemented);
      setConnections(nextConnections);
      setSecrets(nextSecrets);
      setLoadState("ready");
    } catch (caught) {
      if (version !== loadVersion.current) return;
      setError(messageFor(caught, "Connection status is unavailable. Check your session and retry."));
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void load(); return () => { ++loadVersion.current; }; }, [load]);

  const activeSecrets = useMemo(() => secrets.filter((secret) => secret.state === "active"), [secrets]);

  const connectable = providers.filter(provider => provider.availability === "available" || provider.availability === "offline-fixture");
  const actionsDisabled = busy != null || loadState !== "ready";
  const formDisabled = actionsDisabled || setup != null;
  async function addConnection() {
    if (operation.current || loadState !== "ready" || !connectable.some(provider => provider.provider_id === (setup?.provider ?? selectedProvider)) || !connectionName.trim() || (!setup && !credential.trim())) return;
    operation.current = "create";
    setBusy("create");
    setError(null);
    const access = captureAppDataAccess();
    let staged = setup ? { ...setup, name: connectionName.trim() } : null;
    try {
      if (staged) setSetup(staged);
      if (!staged) {
        const provider = selectedProvider, name = connectionName.trim();
        const credentialKey = provider === "offline-fixture" ? "fixture_token" : provider === "ninjatrader" ? "api_key" : "access_token";
        const secret = await createIntegrationSecret({ provider, purpose: "broker-sync", credentials: { [credentialKey]: credential } });
        assertAppDataAccess(access);
        staged = { provider, name, secretId: secret.id, verified: false };
        setSetup(staged);
        setCredential("");
        // Expose confirmed vault metadata even if a later setup step fails.
        setSecrets(current => [...current.filter(item => item.id !== secret.id), secret]);
      }
      if (!staged.verified) {
        await verifyIntegrationSecret(staged.secretId);
        assertAppDataAccess(access);
        staged = { ...staged, verified: true };
        setSetup(staged);
      }
      await createBrokerConnection({ provider: staged.provider, display_name: staged.name, secret_id: staged.secretId });
      assertAppDataAccess(access);
      setSetup(null);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Connection setup failed. Retry setup using the saved credential, or review it in the vault."));
    } finally {
      operation.current = null;
      setBusy(null);
    }
  }

  async function run(actionKey: string, action: () => Promise<unknown>) {
    if (operation.current || loadState !== "ready") return;
    operation.current = actionKey;
    setBusy(actionKey);
    setError(null);
    const access = captureAppDataAccess();
    try {
      await action();
      assertAppDataAccess(access);
      setConfirmAction(null);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "The connection action failed. Retry after reviewing its status."));
    } finally {
      operation.current = null;
      setBusy(null);
    }
  }

  return (
    <SettingsSection title="Providers and credentials" description="Status comes from EdgeLab’s authenticated provider and vault APIs. Credential values are write-only and never displayed again.">
      <SettingRow controlId="broker-connections" label="Broker connections" description="Review supported providers and their connection requirements before connecting." scope="Personal" validation={error}>
        <div className="space-y-3">
          {loadState === "loading" ? <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />Loading provider status…</p> : null}
          {loadState === "error" ? <button type="button" onClick={() => void load()} disabled={busy != null} className="min-h-9 text-sm font-semibold text-[var(--accent-primary)] hover:underline">Retry status check</button> : null}
          {providers.map((provider) => (
            <div key={provider.provider_id} className="rounded-md border border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{provider.display_name}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{provider.description}</p>
                </div>
                <span className="text-xs text-[var(--text-secondary)]">{provider.availability === "available" ? "Available" : provider.availability === "offline-fixture" ? "Local test environment" : provider.availability === "unconfigured" ? "Server setup required" : "Unavailable"}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
                <Capability label="Accounts" enabled={provider.capabilities.accounts} />
                <Capability label="Orders" enabled={provider.capabilities.orders} />
                <Capability label="Fills" enabled={provider.capabilities.fills} />
                <Capability label="Incremental sync" enabled={provider.capabilities.incremental_sync} />
                <Capability label="Live connectivity" enabled={provider.capabilities.live_connectivity} />
                <div><dt className="text-[var(--text-secondary)]">Permissions</dt><dd className="text-[var(--text-secondary)]">{provider.requires_secret ? "Credential required" : "None"}</dd></div>
              </dl>
            </div>
          ))}

          {providers.some((provider) => provider.availability === "available" || provider.availability === "offline-fixture") ? (
            <form className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.03] p-3" onSubmit={(event) => { event.preventDefault(); void addConnection(); }}>
              <p className="text-sm font-medium text-[var(--text-primary)]">Create broker connection</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Credentials are encrypted server-side and never returned. The first refresh verifies provider connectivity and discovers accounts.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="text-xs font-medium text-[var(--text-secondary)]"><p>Provider</p><ThemedSelect ariaLabel="Provider" portal disabled={formDisabled} value={selectedProvider} onChange={value => { setSelectedProvider(value); setConnectionName(connectable.find(provider => provider.provider_id === value)?.display_name ?? ""); setCredential(""); }} className="mt-1 w-full" options={connectable.map(provider => ({ value: provider.provider_id, label: provider.display_name }))} /></div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Connection name<input disabled={actionsDisabled} value={connectionName} onChange={(event) => setConnectionName(event.target.value)} maxLength={120} className={`${fieldClassName} mt-1`} /></label>
                <label className="text-xs font-medium text-[var(--text-secondary)] sm:col-span-2">{selectedProvider === "offline-fixture" ? "Fixture token" : selectedProvider === "ninjatrader" ? "API key" : "Access token"}<input disabled={formDisabled} value={credential} onChange={(event) => setCredential(event.target.value)} type="password" autoComplete="new-password" className={`${fieldClassName} mt-1`} /></label>
              </div>
              <button type="submit" disabled={busy != null || loadState !== "ready" || !connectionName.trim() || (!setup && !credential.trim()) || !connectable.some(provider => provider.provider_id === (setup?.provider ?? selectedProvider))} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent-primary)] px-4 text-sm font-semibold text-[#061017] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-45">
                {busy === "create" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Database aria-hidden="true" className="h-4 w-4" />}
                {busy === "create" ? "Connecting…" : setup ? "Retry connection setup" : "Save credential and create connection"}
              </button>
              {setup ? <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]" role="status"><p>Credential saved for {providers.find(provider => provider.provider_id === setup.provider)?.display_name ?? setup.provider}. You can change the connection name before retrying with the same vault record.</p><button type="button" disabled={busy != null} onClick={() => { setSetup(null); setError(null); }} className="min-h-11 underline underline-offset-4">Discard connection setup</button><p>Discarding setup keeps the credential in the vault. Revoke it there if it is no longer needed.</p></div> : null}
            </form>
          ) : null}

          {connections.length ? <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Configured connections</p>{connections.map((connection) => (
            <div key={connection.id} aria-label={`${connection.display_name} connection`} className="rounded-md border border-[var(--ui-border-subtle)] p-3" role="group">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{connection.display_name}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{connection.provider} · {connection.status} · health {connection.health.toLowerCase()}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Last sync: {connection.last_sync_completed_at ? formatDate(connection.last_sync_completed_at) : "Never"} · Latency: not measured</p>
                  {connection.last_error_message ? <p className="mt-2 flex gap-1.5 text-xs text-[var(--loss-text)]"><AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />{connection.last_error_message}</p> : null}
                </div>
                {connection.revoked_at ? <span className="text-xs text-[var(--text-secondary)]">Revoked {formatDate(connection.revoked_at)}</span> : (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void run(`refresh-${connection.id}`, () => refreshBrokerConnection(connection.id))} disabled={actionsDisabled} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--ui-border-subtle)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--ui-hover)] disabled:opacity-45 sm:min-h-9"><RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${busy === `refresh-${connection.id}` ? "animate-spin motion-reduce:animate-none" : ""}`} />Refresh</button>
                    <button type="button" onClick={() => setConfirmAction(`connection-${connection.id}`)} disabled={actionsDisabled} className="min-h-11 rounded-md px-2.5 text-xs font-medium text-[var(--loss-text)] hover:bg-rose-400/10 disabled:opacity-45 sm:min-h-9">Revoke</button>
                  </div>
                )}
              </div>
              {confirmAction === `connection-${connection.id}` ? <ConfirmDanger message="This stops future refreshes. Imported journal data remains." busy={busy != null || loadState !== "ready"} pending={busy === `revoke-connection-${connection.id}`} onCancel={() => setConfirmAction(null)} onConfirm={() => void run(`revoke-connection-${connection.id}`, () => revokeBrokerConnection(connection.id))} /> : null}
            </div>
          ))}</div> : null}
        </div>
      </SettingRow>

      <SettingRow controlId="credential-vault" label="Credential vault" description="Inspect metadata, test decryptability, re-encrypt with the active vault key, or revoke access." effective={`${activeSecrets.length} active credential record${activeSecrets.length === 1 ? "" : "s"}`} scope="Personal">
        <div className="space-y-2">
          {secrets.length === 0 && loadState === "ready" ? <p className="text-sm text-[var(--text-secondary)]">No credential records.</p> : null}
          {secrets.map((secret) => (
            <div key={secret.id} className="rounded-md border border-[var(--ui-border-subtle)] p-3">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-[var(--accent-primary)]" />{secret.provider}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{secret.purpose} · v{secret.version} · key {secret.key_id} · {secret.state}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Last readiness check: {secret.last_connected_at ? formatDate(secret.last_connected_at) : "Never"}</p>
                </div>
                {secret.state === "active" ? <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto">
                  <button type="button" disabled={actionsDisabled} onClick={() => void run(`verify-${secret.id}`, () => verifyIntegrationSecret(secret.id))} className="min-h-11 rounded px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] sm:min-h-8">Verify</button>
                  <button type="button" disabled={actionsDisabled} onClick={() => void run(`rotate-${secret.id}`, () => rotateIntegrationSecret(secret.id))} className="min-h-11 rounded px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] sm:min-h-8">Re-encrypt</button>
                  <button type="button" disabled={actionsDisabled} onClick={() => setConfirmAction(`secret-${secret.id}`)} className="grid h-11 w-11 place-items-center rounded text-[var(--loss-text)] hover:bg-rose-400/10 sm:h-8 sm:w-8" aria-label={`Revoke ${secret.provider} credential`}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
                </div> : null}
              </div>
              {confirmAction === `secret-${secret.id}` ? <ConfirmDanger message="Connections using this credential will no longer be able to decrypt it." busy={busy != null || loadState !== "ready"} pending={busy === `revoke-secret-${secret.id}`} onCancel={() => setConfirmAction(null)} onConfirm={() => void run(`revoke-secret-${secret.id}`, () => revokeIntegrationSecret(secret.id))} /> : null}
            </div>
          ))}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <div><dt className="text-[var(--text-secondary)]">{label}</dt><dd className={enabled ? "text-[var(--profit-text)]" : "text-[var(--text-secondary)]"}>{enabled ? "Supported" : "Unavailable"}</dd></div>;
}

function ConfirmDanger({ message, busy, pending, onCancel, onConfirm }: { message: string; busy: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div aria-label="Confirm revocation" className="mt-3 border-t border-rose-400/20 pt-3" role="region"><p className="text-xs leading-5 text-[var(--loss-text)]">{message} This action is recorded by the service.</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] sm:min-h-9">Cancel</button><button type="button" onClick={onConfirm} disabled={busy} className="inline-flex min-h-11 items-center gap-1.5 rounded bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-45 sm:min-h-9">{pending ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />}Confirm revoke</button></div></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

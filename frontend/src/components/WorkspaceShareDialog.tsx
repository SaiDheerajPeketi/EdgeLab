import {
  Ban,
  Check,
  Clipboard,
  Clock3,
  Copy,
  Link2,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  ApiError,
  createWorkspaceShare,
  deleteWorkspaceSharePayload,
  getWorkspaceShares,
  revokeWorkspaceShare,
  type WorkspaceShareCreated,
  type WorkspaceShareOwnerRecord,
} from "../lib/api";
import {
  workspaceShareScopeLabel,
  workspaceShareUrl,
  type WorkspaceSharePayload,
  type WorkspaceShareScope,
} from "../lib/workspaceShare";
import { Dialog, IconButton } from "./ui/Primitives";
import { ThemedSelect } from "./ThemedSelect";

type WorkspaceShareDialogProps = {
  buildPayload: (scope: WorkspaceShareScope) => WorkspaceSharePayload;
  onClose: () => void;
  suggestedTitle: string;
  workspaceKey: string;
};

const OWNER_SHARE_PAGE_SIZE = 100;

const SCOPE_OPTIONS: Array<{
  description: string;
  scope: WorkspaceShareScope;
}> = [
  {
    scope: "chart-plus-panels",
    description: "Current chart configuration, visible candles, and aggregate results.",
  },
  {
    scope: "panels-only",
    description: "Aggregate review and results panels without any chart data.",
  },
  {
    scope: "complete-workspace",
    description: "All safe chart panes, panel placement, and workspace layout settings.",
  },
];

export function WorkspaceShareDialog({
  buildPayload,
  onClose,
  suggestedTitle,
  workspaceKey,
}: WorkspaceShareDialogProps) {
  const [scope, setScope] = useState<WorkspaceShareScope>("chart-plus-panels");
  const [title, setTitle] = useState(suggestedTitle);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [expiryDays, setExpiryDays] = useState("7");
  const [createdShare, setCreatedShare] = useState<WorkspaceShareCreated | null>(null);
  const [view, setView] = useState<"create" | "manage">("create");
  const [ownerShares, setOwnerShares] = useState<WorkspaceShareOwnerRecord[]>([]);
  const [shareListStatus, setShareListStatus] = useState<"error" | "loading" | "ready">("loading");
  const [shareListError, setShareListError] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [confirmDeletePayloadId, setConfirmDeletePayloadId] = useState<number | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<number | null>(null);
  const [deletingPayloadId, setDeletingPayloadId] = useState<number | null>(null);
  const shareListRequestRef = useRef(0);
  const [status, setStatus] = useState<"idle" | "creating" | "created" | "revoking" | "revoked">("idle");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const busy =
    status === "creating" ||
    status === "revoking" ||
    revokingShareId != null ||
    deletingPayloadId != null;
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const shareLinkRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const createPanelId = useId();
  const managePanelId = useId();

  async function refreshOwnerShares() {
    const requestId = ++shareListRequestRef.current;
    setConfirmRevokeId(null);
    setConfirmDeletePayloadId(null);
    setShareListStatus("loading");
    setShareListError("");
    try {
      const sharesById = new Map<number, WorkspaceShareOwnerRecord>();
      let offset = 0;
      while (true) {
        const page = await getWorkspaceShares({
          workspaceKey,
          offset,
          limit: OWNER_SHARE_PAGE_SIZE,
        });
        if (shareListRequestRef.current !== requestId) {
          return;
        }
        const previousSize = sharesById.size;
        page.forEach((share) => {
          if (!sharesById.has(share.id)) {
            sharesById.set(share.id, share);
          }
        });
        if (page.length < OWNER_SHARE_PAGE_SIZE || sharesById.size === previousSize) {
          break;
        }
        offset += page.length;
      }
      setOwnerShares(Array.from(sharesById.values()));
      setShareListStatus("ready");
    } catch (cause) {
      if (shareListRequestRef.current !== requestId) {
        return;
      }
      setShareListError(
        cause instanceof ApiError && cause.message
          ? cause.message
          : "Share links could not be loaded. Check your connection and retry.",
      );
      setShareListStatus("error");
    }
  }

  useEffect(() => {
    void refreshOwnerShares();
    return () => {
      shareListRequestRef.current += 1;
    };
  }, [workspaceKey]);

  useEffect(() => {
    if (!createdShare) {
      return;
    }
    const frame = window.requestAnimationFrame(() => shareLinkRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [createdShare]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || status === "creating") {
      return;
    }
    setStatus("creating");
    setError("");
    try {
      const days = Number(expiryDays);
      const expiresAt = Number.isFinite(days)
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const share = await createWorkspaceShare({
        workspace_key: workspaceKey,
        title: title.trim(),
        scope,
        recipient_email: recipientEmail.trim().toLowerCase() || null,
        expires_at: expiresAt,
        payload: buildPayload(scope),
      });
      setCreatedShare(share);
      const ownerRecord = ownerRecordForCreatedShare(share);
      setOwnerShares((current) => [
        ownerRecord,
        ...current.filter((item) => item.id !== ownerRecord.id),
      ]);
      setStatus("created");
      void refreshOwnerShares();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.message
          ? cause.message
          : "The snapshot could not be created. Check your connection and try again.",
      );
      setStatus("idle");
    }
  }

  async function copyLink() {
    if (!createdShare || status === "revoked") {
      return;
    }
    try {
      await navigator.clipboard.writeText(workspaceShareUrl(createdShare.public_token));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  async function revokeLink() {
    if (!createdShare || status === "revoking" || status === "revoked") {
      return;
    }
    setStatus("revoking");
    setError("");
    try {
      const revoked = await revokeWorkspaceShare(createdShare.id);
      setOwnerShares((current) =>
        current.map((share) => (share.id === revoked.id ? revoked : share)),
      );
      setConfirmRevokeId(null);
      setStatus("revoked");
      void refreshOwnerShares();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.message
          ? cause.message
          : "The link could not be revoked. Try again.",
      );
      setStatus("created");
    }
  }

  async function revokeOwnerShare(shareId: number) {
    if (revokingShareId != null || deletingPayloadId != null) {
      return;
    }
    setRevokingShareId(shareId);
    setShareListError("");
    try {
      const revoked = await revokeWorkspaceShare(shareId);
      setOwnerShares((current) =>
        current.map((share) => (share.id === revoked.id ? revoked : share)),
      );
      if (createdShare?.id === revoked.id) {
        setStatus("revoked");
      }
      setConfirmRevokeId(null);
    } catch (cause) {
      setShareListError(
        cause instanceof ApiError && cause.message
          ? cause.message
          : "The link could not be revoked. Check your connection and retry.",
      );
    } finally {
      setRevokingShareId(null);
    }
  }

  async function deleteOwnerSharePayload(shareId: number) {
    if (deletingPayloadId != null || revokingShareId != null) {
      return;
    }
    const share = ownerShares.find((candidate) => candidate.id === shareId);
    if (!share || !canDeleteOwnerSharePayload(share)) {
      return;
    }
    setDeletingPayloadId(shareId);
    setShareListError("");
    try {
      const updated = await deleteWorkspaceSharePayload(shareId);
      setOwnerShares((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setCreatedShare((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current,
      );
      setConfirmDeletePayloadId(null);
    } catch (cause) {
      setShareListError(
        cause instanceof ApiError && cause.message
          ? cause.message
          : "Stored snapshot data could not be deleted. Check your connection and retry.",
      );
    } finally {
      setDeletingPayloadId(null);
    }
  }

  const shareUrl = createdShare ? workspaceShareUrl(createdShare.public_token) : "";

  return (
    <Dialog open label="Share a workspace copy" onClose={onClose} dismissBlocked={busy} initialFocusRef={titleInputRef} className="max-w-2xl max-sm:mb-[calc(4.5rem+env(safe-area-inset-bottom))] max-sm:max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
      <div
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-[#0b1017] text-slate-100 shadow-[0_28px_90px_rgba(0,0,0,0.62)] sm:max-w-2xl sm:rounded-2xl"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-5 border-b border-white/10 px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-white" id={titleId}>Share a workspace copy</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400" id={descriptionId}>
              Create an immutable snapshot. Only you and the named EdgeLab account can open it.
            </p>
          </div>
          <IconButton
            label="Close share dialog"
            icon={X}
            disabled={busy}
            onClick={onClose}
          />
        </div>

        <div aria-label="Share workspace sections" className="grid grid-cols-2 border-b border-white/10 px-5 sm:px-6" role="tablist">
          <button
            aria-controls={createPanelId}
            aria-selected={view === "create"}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/50 ${view === "create" ? "border-cyan-300 text-white" : "border-transparent text-slate-300 hover:text-white"}`}
            disabled={busy}
            onClick={() => setView("create")}
            role="tab"
            type="button"
          >
            Create link
          </button>
          <button
            aria-controls={managePanelId}
            aria-selected={view === "manage"}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/50 ${view === "manage" ? "border-cyan-300 text-white" : "border-transparent text-slate-300 hover:text-white"}`}
            disabled={busy}
            onClick={() => setView("manage")}
            role="tab"
            type="button"
          >
            Manage links{ownerShares.length > 0 ? ` (${ownerShares.length})` : ""}
          </button>
        </div>

        {view === "manage" ? (
          <ManageWorkspaceShares
            confirmDeletePayloadId={confirmDeletePayloadId}
            confirmRevokeId={confirmRevokeId}
            deletingPayloadId={deletingPayloadId}
            error={shareListError}
            id={managePanelId}
            onCancelDeletePayload={() => setConfirmDeletePayloadId(null)}
            onCreate={() => setView("create")}
            onCancelRevoke={() => setConfirmRevokeId(null)}
            onConfirmDeletePayload={(shareId) => void deleteOwnerSharePayload(shareId)}
            onConfirmRevoke={(shareId) => void revokeOwnerShare(shareId)}
            onRefresh={() => void refreshOwnerShares()}
            onRequestDeletePayload={(shareId) => {
              setConfirmRevokeId(null);
              setConfirmDeletePayloadId(shareId);
            }}
            onRequestRevoke={(shareId) => {
              setConfirmDeletePayloadId(null);
              setConfirmRevokeId(shareId);
            }}
            revokingShareId={revokingShareId}
            shares={ownerShares}
            status={shareListStatus}
          />
        ) : createdShare ? (
          <div aria-label="Create share link" className="space-y-5 p-5 sm:p-6" id={createPanelId} role="tabpanel">
            <div className={`rounded-xl px-4 py-4 ${status === "revoked" ? "bg-rose-400/10 text-rose-100" : "bg-emerald-400/10 text-emerald-100"}`}>
              <div className="flex items-start gap-3">
                {status === "revoked" ? <Ban aria-hidden="true" className="mt-0.5" size={19} /> : <Check aria-hidden="true" className="mt-0.5" size={19} />}
                <div>
                  <p className="font-semibold">{status === "revoked" ? "Link revoked" : `Snapshot v${createdShare.snapshot_version} is ready`}</p>
                  <p className="mt-1 text-sm opacity-75">
                    {status === "revoked" ? "This token can no longer open the snapshot." : "The source workspace will never change when this copy is opened."}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-200" htmlFor="workspace-share-link">Secure link</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className="min-h-11 min-w-0 rounded-xl bg-black/30 px-3 text-base text-slate-300 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-300/45 disabled:opacity-50"
                  disabled={status === "revoked"}
                  id="workspace-share-link"
                  readOnly
                  ref={shareLinkRef}
                  value={shareUrl}
                />
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-[#041217] outline-none transition hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={status === "revoked"}
                  onClick={() => void copyLink()}
                  type="button"
                >
                  {copyStatus === "copied" ? <Check size={17} /> : <Copy size={17} />}
                  {copyStatus === "copied" ? "Copied" : "Copy link"}
                </button>
              </div>
              <p aria-live="polite" className={`mt-2 text-xs ${copyStatus === "failed" ? "text-rose-200" : "text-slate-300"}`}>
                {copyStatus === "failed"
                  ? "Clipboard access was blocked. Select the link and copy it manually."
                  : createdShare.recipient_email
                    ? `Access is locked to ${createdShare.recipient_email}.`
                    : "No recipient was named, so this copy is owner-only."}
              </p>
              {status !== "revoked" ? (
                <p className="mt-2 text-xs leading-5 text-amber-100/80">
                  This is the only time EdgeLab shows this secure link. You can manage or revoke the snapshot later, but its token cannot be revealed again.
                </p>
              ) : null}
            </div>

            {error ? <p className="text-sm text-rose-200" role="alert">{error}</p> : null}

            <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-5 sm:flex-row sm:justify-between">
              {status !== "revoked" ? (
                confirmRevokeId === createdShare.id ? (
                  <div className="flex gap-2">
                    <button
                      className="min-h-11 rounded-xl px-3 text-sm font-semibold text-slate-300 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/50"
                      disabled={status === "revoking"}
                      onClick={() => setConfirmRevokeId(null)}
                      type="button"
                    >
                      Keep link
                    </button>
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-400/12 px-4 text-sm font-semibold text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:cursor-wait disabled:opacity-50"
                      disabled={status === "revoking"}
                      onClick={() => void revokeLink()}
                      type="button"
                    >
                      <Ban size={17} />
                      {status === "revoking" ? "Revoking…" : "Revoke now"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-rose-200 outline-none transition hover:bg-rose-400/10 focus-visible:ring-2 focus-visible:ring-rose-300/50"
                    onClick={() => setConfirmRevokeId(createdShare.id)}
                    type="button"
                  >
                    <Ban size={17} />
                    Revoke link
                  </button>
                )
              ) : <span />}
              <button className="min-h-11 rounded-xl px-4 text-sm font-semibold text-white outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/50" onClick={onClose} type="button">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form aria-label="Create share link" className="space-y-6 p-5 sm:p-6" id={createPanelId} onSubmit={(event) => void handleSubmit(event)} role="tabpanel">
            <label className="block">
              <span className="text-sm font-semibold text-slate-200">Snapshot name</span>
              <input
                aria-describedby={error ? errorId : undefined}
                className="mt-2 min-h-11 w-full rounded-xl bg-black/30 px-3 text-base text-white outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-cyan-300/45"
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                ref={titleInputRef}
                required
                value={title}
              />
            </label>

            <fieldset>
              <legend className="text-sm font-semibold text-slate-200">What to include</legend>
              <div className="mt-3 grid gap-2">
                {SCOPE_OPTIONS.map((option) => (
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 outline-none ring-1 transition focus-within:ring-2 focus-within:ring-cyan-300/50 ${scope === option.scope ? "bg-cyan-300/[0.08] ring-cyan-300/35" : "bg-white/[0.025] ring-white/10 hover:bg-white/[0.045]"}`}
                    key={option.scope}
                  >
                    <input
                      checked={scope === option.scope}
                      className="mt-1 h-4 w-4 accent-cyan-300"
                      name="workspace-share-scope"
                      onChange={() => setScope(option.scope)}
                      type="radio"
                      value={option.scope}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{workspaceShareScopeLabel(option.scope)}</span>
                      <span className="mt-1 block text-sm leading-5 text-slate-400">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200"><Mail size={15} />Recipient account</span>
                <input
                  autoComplete="email"
                  className="mt-2 min-h-11 w-full rounded-xl bg-black/30 px-3 text-base text-white outline-none ring-1 ring-white/10 transition placeholder:text-slate-600 focus:ring-2 focus:ring-cyan-300/45"
                  inputMode="email"
                  maxLength={320}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="trader@example.com (optional)"
                  type="email"
                  value={recipientEmail}
                />
                <span className="mt-2 block text-xs leading-5 text-slate-300">Leave blank for an owner-only cross-device copy.</span>
              </label>
              <label className="block">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200"><LockKeyhole size={15} />Expires</span>
                <ThemedSelect
                  ariaLabel="Expires"
                  className="mt-2 h-11 w-full text-base"
                  onChange={setExpiryDays}
                  options={[
                    { label: "In 24 hours", value: "1" },
                    { label: "In 7 days", value: "7" },
                    { label: "In 30 days", value: "30" },
                    { label: "Never", value: "never" },
                  ]}
                  portal
                  value={expiryDays}
                />
              </label>
            </div>

            <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] p-4 text-sm text-slate-400">
              <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-300" size={18} />
              <p className="leading-6">Credentials, orders, positions, executions, and journal records are always excluded. Opening creates an independent copy.</p>
            </div>

            {error ? <p className="text-sm text-rose-200" id={errorId} role="alert">{error}</p> : null}

            <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
              <button className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-300 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/50" disabled={busy} onClick={onClose} type="button">Cancel</button>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-[#041217] outline-none transition hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-wait disabled:opacity-60"
                disabled={busy || !title.trim()}
                type="submit"
              >
                {status === "creating" ? <Clipboard className="animate-pulse motion-reduce:animate-none" size={17} /> : <Link2 size={17} />}
                {status === "creating" ? "Creating snapshot…" : "Create secure link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}

type ManageWorkspaceSharesProps = {
  confirmDeletePayloadId: number | null;
  confirmRevokeId: number | null;
  deletingPayloadId: number | null;
  error: string;
  id: string;
  onCancelDeletePayload: () => void;
  onCancelRevoke: () => void;
  onConfirmDeletePayload: (shareId: number) => void;
  onConfirmRevoke: (shareId: number) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onRequestDeletePayload: (shareId: number) => void;
  onRequestRevoke: (shareId: number) => void;
  revokingShareId: number | null;
  shares: WorkspaceShareOwnerRecord[];
  status: "error" | "loading" | "ready";
};

function ManageWorkspaceShares({
  confirmDeletePayloadId,
  confirmRevokeId,
  deletingPayloadId,
  error,
  id,
  onCancelDeletePayload,
  onCancelRevoke,
  onConfirmDeletePayload,
  onConfirmRevoke,
  onCreate,
  onRefresh,
  onRequestDeletePayload,
  onRequestRevoke,
  revokingShareId,
  shares,
  status,
}: ManageWorkspaceSharesProps) {
  return (
    <section aria-label="Manage share links" className="space-y-5 p-5 sm:p-6" id={id} role="tabpanel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-white">Saved links</h3>
          <p className="mt-1 max-w-lg text-sm leading-6 text-slate-400">
            Review snapshot access and revoke active links. Secure tokens are only shown once and are never listed here.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-slate-200 outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/50 disabled:cursor-wait disabled:opacity-50"
          disabled={status === "loading" || revokingShareId != null || deletingPayloadId != null}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={status === "loading" ? "animate-spin motion-reduce:animate-none" : ""}
            size={16}
          />
          Refresh
        </button>
      </div>

      {status === "ready" && error ? (
        <p className="rounded-xl bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100" role="alert">
          {error}
        </p>
      ) : null}

      {status === "loading" ? (
        <div className="flex min-h-32 items-center justify-center rounded-xl border border-white/10 bg-white/[0.025] px-4 text-sm text-slate-400" role="status">
          <RefreshCw aria-hidden="true" className="mr-2 animate-spin motion-reduce:animate-none" size={17} />
          Loading share links…
        </div>
      ) : status === "error" ? (
        <div className="rounded-xl border border-rose-300/20 bg-rose-400/[0.07] p-4" role="alert">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-white outline-none ring-1 ring-white/15 transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-rose-200/60"
            onClick={onRefresh}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : shares.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-8 text-center">
          <ShieldCheck aria-hidden="true" className="mx-auto text-cyan-300" size={24} />
          <p className="mt-3 font-semibold text-white">No saved links yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-400">
            Create an immutable workspace snapshot when you are ready to share or reopen it elsewhere.
          </p>
          <button
            className="mt-4 min-h-11 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-[#041217] outline-none transition hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100"
            onClick={onCreate}
            type="button"
          >
            Create a link
          </button>
        </div>
      ) : (
        <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.02]">
          {shares.map((share) => {
            const shareStatus = ownerShareStatus(share);
            const isConfirmingRevoke = confirmRevokeId === share.id;
            const isConfirmingDeletePayload = confirmDeletePayloadId === share.id;
            const isRevoking = revokingShareId === share.id;
            const isDeletingPayload = deletingPayloadId === share.id;
            const canDeletePayload = canDeleteOwnerSharePayload(share);
            return (
              <article className="p-4 sm:p-5" key={share.id}>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h4 className="min-w-0 break-words font-semibold text-white" title={share.title}>{share.title}</h4>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${shareStatus.className}`}>
                        {shareStatus.icon}
                        {shareStatus.label}
                      </span>
                      {!share.payload_available ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-400/10 px-2.5 py-1 text-xs font-semibold text-slate-300">
                          <Trash2 aria-hidden="true" size={12} />
                          Data deleted
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-300">
                      Snapshot v{share.snapshot_version} · {workspaceShareScopeLabel(share.scope)}
                    </p>
                    {share.recipient_email ? (
                      <p className="mt-1 break-all text-sm text-slate-300">For {share.recipient_email}</p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-300">Owner-only access</p>
                    )}
                    <dl className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <Clock3 aria-hidden="true" className="shrink-0" size={14} />
                        <dt className="sr-only">Created</dt>
                        <dd>Created {formatShareDate(share.created_at)}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock3 aria-hidden="true" className="shrink-0" size={14} />
                        <dt className="sr-only">Expiry</dt>
                        <dd>{share.expires_at ? `Expires ${formatShareDate(share.expires_at)}` : "Does not expire"}</dd>
                      </div>
                    </dl>
                    {!share.payload_available ? (
                      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-400">
                        <Trash2 aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
                        Stored snapshot data was permanently deleted. This history record remains for reference.
                      </p>
                    ) : null}
                  </div>

                  {shareStatus.label === "Active" ? (
                    <button
                      aria-expanded={isConfirmingRevoke}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-rose-200 outline-none transition hover:bg-rose-400/10 focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:opacity-50"
                      disabled={revokingShareId != null || deletingPayloadId != null}
                      onClick={() => onRequestRevoke(share.id)}
                      type="button"
                    >
                      <Ban aria-hidden="true" size={16} />
                      Revoke
                    </button>
                  ) : canDeletePayload ? (
                    <button
                      aria-expanded={isConfirmingDeletePayload}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-rose-200 outline-none transition hover:bg-rose-400/10 focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:opacity-50"
                      disabled={revokingShareId != null || deletingPayloadId != null}
                      onClick={() => onRequestDeletePayload(share.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                      Delete stored data
                    </button>
                  ) : null}
                </div>

                {shareStatus.label === "Active" && isConfirmingRevoke ? (
                  <div aria-live="polite" className="mt-4 flex flex-col gap-3 rounded-xl bg-rose-400/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-rose-100">Revoke this link? Anyone using it will immediately lose access.</p>
                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        className="min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold text-slate-200 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/50 sm:flex-none"
                        disabled={isRevoking}
                        onClick={onCancelRevoke}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="min-h-11 flex-1 rounded-xl bg-rose-400/15 px-4 text-sm font-semibold text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:cursor-wait disabled:opacity-50 sm:flex-none"
                        disabled={isRevoking}
                        onClick={() => onConfirmRevoke(share.id)}
                        type="button"
                      >
                        {isRevoking ? "Revoking…" : "Revoke now"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {canDeletePayload && isConfirmingDeletePayload ? (
                  <div aria-live="polite" className="mt-4 flex flex-col gap-3 rounded-xl bg-rose-400/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-5 text-rose-100">
                      Permanently delete this snapshot’s stored data? It cannot be recovered, and the history record will remain.
                    </p>
                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        className="min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold text-slate-200 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/50 sm:flex-none"
                        disabled={isDeletingPayload}
                        onClick={onCancelDeletePayload}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="min-h-11 flex-1 rounded-xl bg-rose-400/15 px-4 text-sm font-semibold text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:cursor-wait disabled:opacity-50 sm:flex-none"
                        disabled={isDeletingPayload}
                        onClick={() => onConfirmDeletePayload(share.id)}
                        type="button"
                      >
                        {isDeletingPayload ? "Deleting…" : "Delete permanently"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ownerRecordForCreatedShare(share: WorkspaceShareCreated): WorkspaceShareOwnerRecord {
  return {
    created_at: share.created_at,
    expires_at: share.expires_at,
    id: share.id,
    payload_available: share.payload_available,
    recipient_email: share.recipient_email,
    revoked_at: share.revoked_at,
    schema_version: share.schema_version,
    scope: share.scope,
    snapshot_version: share.snapshot_version,
    title: share.title,
    workspace_key: share.workspace_key,
  };
}

function canDeleteOwnerSharePayload(share: WorkspaceShareOwnerRecord) {
  return share.payload_available && ownerShareStatus(share).label !== "Active";
}

function ownerShareStatus(share: WorkspaceShareOwnerRecord) {
  if (share.revoked_at) {
    return {
      className: "bg-rose-400/10 text-rose-100",
      icon: <Ban aria-hidden="true" size={12} />,
      label: "Revoked" as const,
    };
  }
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return {
      className: "bg-amber-300/10 text-amber-100",
      icon: <Clock3 aria-hidden="true" size={12} />,
      label: "Expired" as const,
    };
  }
  return {
    className: "bg-emerald-400/10 text-emerald-100",
    icon: <Check aria-hidden="true" size={12} />,
    label: "Active" as const,
  };
}

function formatShareDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "date unavailable";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

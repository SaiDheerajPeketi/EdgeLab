import {
  BadgeCheck,
  ChevronDown,
  Database,
  HelpCircle,
  Info,
  Keyboard,
  LogOut,
  MessageSquareQuote,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { deleteAuthSession } from "../lib/api";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  initialsForName,
  subscribeAuthSession,
} from "../lib/authSession";
import type { WorkspaceView } from "../lib/workspace";
import { settingsDeepLink, type SettingsCategoryId } from "./settings/settingsCatalog";
import { OverlaySurface } from "./overlays/OverlaySurface";

const LOGOUT_REDIRECT_TIMEOUT_MS = 800;
type Props = {
  collapsed?: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onRequestClose?: () => void;
  presentation?: "inline" | "popover";
};

function useAuthSession() {
  return useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
}

export function AccountSystemMenu({
  collapsed = false,
  onNavigate,
  onRequestClose,
  presentation = "popover",
}: Props) {
  const session = useAuthSession();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const titleId = useId();
  const shortcutId = useId();

  function closePopover(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open || presentation !== "popover") {
      return;
    }

    window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-menu-focus]")?.focus();
    });

    return undefined;
  }, [open, presentation]);

  if (!session) {
    return null;
  }

  function navigate(view: WorkspaceView) {
    setOpen(false);
    onRequestClose?.();
    onNavigate(view);
  }

  function navigateSettings(category: SettingsCategoryId, controlId?: string) {
    window.history.replaceState(window.history.state, "", settingsDeepLink(category, controlId));
    navigate("globalSettings");
  }

  async function handleSignOut() {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    const token = session?.token;
    clearStoredAuthSession({ notify: false });
    if (token) {
      await Promise.race([
        deleteAuthSession(token).catch(() => undefined),
        new Promise((resolve) => window.setTimeout(resolve, LOGOUT_REDIRECT_TIMEOUT_MS)),
      ]);
    }
    window.location.replace("/");
  }

  const panel = (
    <div
      aria-labelledby={titleId}
      className={
        presentation === "popover"
          ? "w-[min(340px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1017] p-3 text-slate-200 shadow-[0_24px_70px_rgba(0,0,0,0.56)] ring-1 ring-cyan-300/10"
          : "rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-slate-200"
      }
      id={panelId}
      role="group"
    >
      <div className="flex min-w-0 items-center gap-3 px-2 py-2">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-300 text-sm font-bold text-slate-950 shadow-[0_8px_24px_rgba(34,211,238,0.2)]">
          {initialsForName(session.user.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white" id={titleId} title={session.user.name}>
            {session.user.name}
          </div>
          <div className="truncate text-xs text-slate-400" title={session.user.email}>
            {session.user.email}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-cyan-300/[0.07] px-3 py-2.5 text-xs">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-cyan-50">
          <BadgeCheck aria-hidden="true" className="shrink-0" size={16} />
          {session.user.deploymentMode === "beta" ? "Beta access" : session.user.plan === "pro" && session.user.workspaceAccess ? "Pro access" : "Account"}
        </span>
        <span className="truncate text-[var(--text-primary)]">
          {session.user.provider === "google" ? "Google account" : "Email account"}
        </span>
      </div>

      <div className="my-3 h-px bg-white/10" />
      <div className="grid gap-1">
        <MenuAction
          dataMenuFocus
          icon={Settings}
          label="Workspace settings"
          onClick={() => navigateSettings("global")}
        />
        <MenuAction
          icon={Database}
          label="Data-provider status"
          onClick={() => navigateSettings("data-providers", "broker-connections")}
        />
        <MenuAction
          icon={MessageSquareQuote}
          label="Send feedback"
          onClick={() => navigate("feedback")}
        />
        <MenuAction
          icon={Info}
          label="Release information"
          detail="EdgeLab beta · build 0.1"
          onClick={() => navigateSettings("account", "account-identity")}
        />
        <button
          aria-controls={shortcutId}
          aria-expanded={shortcutsOpen}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-slate-300 outline-none transition hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/45"
          onClick={() => setShortcutsOpen((value) => !value)}
          type="button"
        >
          <Keyboard aria-hidden="true" size={17} />
          <span className="flex-1">Help & shortcuts</span>
          <ChevronDown
            aria-hidden="true"
            className={`transition-transform duration-200 ${shortcutsOpen ? "rotate-180" : ""}`}
            size={16}
          />
        </button>
      </div>

      {shortcutsOpen ? (
        <div className="mx-1 mt-1 rounded-xl bg-black/25 px-3 py-3" id={shortcutId}>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
            <HelpCircle aria-hidden="true" size={15} />
            Quick reference
          </div>
          <dl className="grid gap-2 text-xs text-slate-400">
            <ShortcutRow keys="Alt / Option" label="Circular chart tools" />
            <ShortcutRow keys="1–8" label="Choose a radial tool" />
            <ShortcutRow keys="Arrows + Enter" label="Move and select" />
            <ShortcutRow keys="⌘ / Ctrl Z" label="Undo drawing" />
            <ShortcutRow keys="Esc" label="Close the active menu" />
          </dl>
        </div>
      ) : null}

      <div className="my-3 h-px bg-white/10" />
      <button
        aria-live="polite"
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-rose-200 outline-none transition hover:bg-rose-400/10 focus-visible:ring-2 focus-visible:ring-rose-300/45 disabled:cursor-wait disabled:opacity-60"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
        type="button"
      >
        <LogOut aria-hidden="true" size={17} />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );

  if (presentation === "inline") {
    return panel;
  }

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={collapsed ? `Open account menu for ${session.user.name}` : undefined}
        className={`group flex min-h-11 w-full items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-left outline-none transition hover:border-cyan-300/20 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/45 ${
          collapsed ? "justify-center p-0" : "gap-3 px-2.5 py-2"
        }`}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title={collapsed ? `${session.user.name} · Account & system` : undefined}
        type="button"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-300 text-xs font-bold text-slate-950">
          {initialsForName(session.user.name)}
        </div>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white" title={session.user.name}>
                {session.user.name}
              </span>
              <span className="block truncate text-[11px] text-slate-500" title={session.user.email}>
                Beta · {session.user.email}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              size={16}
            />
          </>
        ) : null}
      </button>
      <OverlaySurface
        align="left"
        anchorRef={triggerRef}
        ariaLabelledBy={titleId}
        className="z-[180]"
        estimatedHeight={560}
        onDismiss={() => closePopover(false)}
        open={open}
        preferredWidth={340}
        role="dialog"
        surfaceRef={panelRef}
        triggerRef={triggerRef}
      >
        {panel}
      </OverlaySurface>
    </>
  );
}

function MenuAction({
  dataMenuFocus = false,
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  dataMenuFocus?: boolean;
  icon: LucideIcon;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-slate-300 outline-none transition hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/45"
      data-menu-focus={dataMenuFocus ? "true" : undefined}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={17} />
      <span className="min-w-0 flex-1"><span className="block truncate">{label}</span>{detail ? <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-300">{detail}</span> : null}</span>
    </button>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt>{label}</dt>
      <dd className="shrink-0 rounded-md bg-white/[0.07] px-2 py-1 font-data text-[10px] font-semibold text-slate-200">
        {keys}
      </dd>
    </div>
  );
}

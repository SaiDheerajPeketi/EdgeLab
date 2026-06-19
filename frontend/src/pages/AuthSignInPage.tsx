import { ArrowRight, Chrome, DatabaseZap, LockKeyhole, Sparkles } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { EdgeLabWordmark, MarketingShell } from "../components/marketing/MarketingShell";
import { ApiError, requestBetaAccess } from "../lib/api";
import { setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import { isBetaMode, deploymentMode } from "../lib/deploymentMode";
import { buildGoogleAuthorizeUrl, isGoogleAuthConfigured } from "../lib/googleAuth";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

function useFromPath() {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  return searchParams.get("from") || "/app";
}

export function AuthSignInPage() {
  const location = useLocation();
  const fromPath = useFromPath();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [email, setEmail] = useState("beta@edgelab.app");
  const [name, setName] = useState("Beta Trader");
  const [errorMessage, setErrorMessage] = useState<string | null>(searchParams.get("error"));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { program } = useBetaProgramStatus();
  const waitlistMode = searchParams.get("waitlist") === "1";
  const googleReady = isGoogleAuthConfigured();

  const handleDemoSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await requestBetaAccess({
        email,
        name,
        provider: "email",
      });
      const session = toStoredAuthSession(response.session);
      setStoredAuthSession(session);
      navigate(session.user.approved ? fromPath : "/auth/signin?waitlist=1", { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Beta access failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = () => {
    if (!googleReady) {
      setErrorMessage("Set VITE_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google OAuth");
      return;
    }
    window.location.href = buildGoogleAuthorizeUrl(fromPath);
  };

  return (
    <MarketingShell
      navItems={[
        { href: "/#features", label: "Features" },
        { href: "/pricing", label: "Pricing" },
        { href: "/#faq", label: "Docs" },
      ]}
      pageTitle="auth"
    >
      <section className="px-4 pb-24 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,460px)]">
          <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(50,211,238,0.18),rgba(255,255,255,0.035))] p-8 shadow-card">
            <EdgeLabWordmark />
            <div className="mt-10 max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">
                Beta Access
              </div>
              <h1 className="text-display mt-4 text-5xl text-white">
                Enter beta. Pressure-test your process.
              </h1>
              <p className="mt-5 text-lg leading-8 text-slate-200">
                Email path is live now. Waitlist kicks in automatically when seats fill.
                Google auth comes later. Beta data is temporary and will be pruned after beta closes.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { icon: Sparkles, label: "Beta seats", value: `${program.seats_remaining} left` },
                { icon: LockKeyhole, label: "Protected route", value: "/app" },
                { icon: DatabaseZap, label: "Data retention", value: "Pruned after beta" },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="rounded-[24px] border border-white/10 bg-black/20 p-4"
                  >
                    <Icon className="text-cyan-100" size={18} />
                    <div className="mt-4 font-data text-lg text-white">{item.value}</div>
                    <div className="mt-1 text-sm text-slate-400">{item.label}</div>
                  </div>
                );
              })}
            </div>

            {isBetaMode(deploymentMode) ? (
              <div className="mt-8 rounded-[26px] border border-amber-300/20 bg-amber-300/10 p-5 text-sm leading-7 text-amber-100">
                Beta gate live. {program.seats_taken}/{program.seats_total} seats claimed.
                {program.seats_remaining > 0
                  ? " Seats open now."
                  : ` Seats full. Waitlist collecting ${program.waitlist_count} traders.`}
              </div>
            ) : null}
          </div>

          <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8 shadow-card backdrop-blur-xl">
            <div className="text-sm text-slate-400">Access EdgeLab beta</div>
            <div className="mt-2 text-3xl font-semibold text-white">
              {waitlistMode ? "Beta full. Join waitlist." : "Sign in to continue"}
            </div>

            <form className="grid gap-4" onSubmit={handleDemoSignIn}>
              <label className="grid gap-2 text-sm text-slate-400">
                Name
                <input
                  className="input-control h-12 rounded-2xl border-white/10 bg-black/25"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Trader name"
                  type="text"
                  value={name}
                />
              </label>

              <label className="grid gap-2 text-sm text-slate-400">
                Email
                <input
                  className="input-control h-12 rounded-2xl border-white/10 bg-black/25"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@desk.com"
                  type="email"
                  value={email}
                />
              </label>

              <label className="grid gap-2 text-sm text-slate-400">
                Password
                <input
                  className="input-control h-12 rounded-2xl border-white/10 bg-black/25"
                  disabled
                  placeholder="Reserved for later auth pass"
                  type="password"
                />
              </label>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Workspace redirect: {fromPath}</span>
                <button className="text-cyan-100" type="button">
                  Forgot password
                </button>
              </div>

              <button
                className="mt-2 inline-flex items-center justify-center rounded-full bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting
                  ? "Requesting access..."
                  : program.seats_remaining > 0
                    ? "Enter beta workspace"
                    : "Join beta waitlist"}
              </button>
            </form>

            <div className="mt-5 rounded-[22px] border border-white/10 bg-black/25 px-4 py-4 text-sm leading-7 text-slate-300">
              <div className="flex items-center gap-2 text-slate-100">
                <Chrome size={15} />
                Google auth later
              </div>
              <div className="mt-2">
                Public OAuth path stays parked for now. Beta flow uses email seat issuance so replay,
                journal, and analytics feedback can ship first.
              </div>
              {googleReady ? (
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:text-cyan-100"
                  onClick={handleGoogleSignIn}
                  type="button"
                >
                  Try staged Google flow
                  <ArrowRight size={14} />
                </button>
              ) : null}
            </div>

            {waitlistMode ? (
              <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-7 text-amber-100">
                Beta seats full. Join waitlist now. Current queue: {program.waitlist_count} traders.
              </div>
            ) : null}

            <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-7 text-amber-100">
              Beta rule: export anything critical. Workspace data can be pruned once beta closes.
            </div>

            {errorMessage ? (
              <div className="mt-5 rounded-[22px] border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm leading-7 text-rose-100">
                {errorMessage}
              </div>
            ) : null}

            <p className="mt-6 text-sm leading-7 text-slate-400">
              Don&apos;t have account yet?{" "}
              {program.seats_remaining > 0 ? "Use beta entry now," : "Join waitlist now,"}{" "}
              or jump back to{" "}
              <Link className="ml-1 text-cyan-100" to="/">
                landing page
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

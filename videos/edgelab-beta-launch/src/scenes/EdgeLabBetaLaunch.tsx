import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SessionGateway } from "../../../../frontend/src/components/SessionGateway";
import { HeroDemo } from "../../../../frontend/src/components/marketing/HeroDemo";
import { EdgeLabWordmark } from "../../../../frontend/src/components/brand/EdgeLabBrand";
import { Sidebar } from "../../../../frontend/src/components/Sidebar";
import { datasets, noopCreateSession, playbooks, sessions, trades } from "../data/mock-data";

const CANVAS = "bg-[radial-gradient(circle_at_top,rgba(50,211,238,0.18),transparent_26%),linear-gradient(180deg,#04070b_0%,#05070a_100%)]";

const DeviceFrame = ({ children }: { children: ReactNode }) => {
  return (
    <div className="rounded-[32px] border border-white/10 bg-[#04070bcc] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#05070a]">
        {children}
      </div>
    </div>
  );
};

const ScaledViewport = ({
  children,
  className = "",
  scale,
  width,
}: {
  children: ReactNode;
  className?: string;
  scale: number;
  width: number;
}) => {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width,
        }}
      >
        {children}
      </div>
    </div>
  );
};

const TitleCard = ({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });

  return (
    <div
      className="max-w-[720px]"
      style={{
        opacity: enter,
        transform: `translateY(${24 - enter * 24}px)`,
      }}
    >
      <div className="text-[12px] font-semibold uppercase tracking-[0.26em] text-cyan-100/65">
        {eyebrow}
      </div>
      <h2 className="mt-4 font-display text-[72px] font-semibold leading-[0.92] tracking-[-0.08em] text-white">
        {title}
      </h2>
      <p className="mt-5 max-w-[620px] text-[24px] leading-[1.6] text-slate-300">
        {body}
      </p>
    </div>
  );
};

const IntroScene = () => {
  return (
    <AbsoluteFill className={`${CANVAS} justify-center px-24`}>
      <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="mx-auto flex w-full max-w-[1480px] items-end justify-between gap-16">
        <TitleCard
          eyebrow="Beta Launch"
          title="Your edge, engineered into one trading loop."
          body="Verified from the repo: replay, execution, journaling, review analytics, live watchlists, economic calendar, feedback, and workspace data control."
        />
        <div className="shrink-0">
          <EdgeLabWordmark size="hero" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const AuthScene = () => {
  return (
    <AbsoluteFill className={`${CANVAS} px-24 py-20`}>
      <div className="mx-auto grid h-full w-full max-w-[1520px] grid-cols-[520px_minmax(0,1fr)] gap-14">
        <div className="self-center">
          <TitleCard
            eyebrow="Beta Access"
            title="Private seats. Immediate context."
            body="The product ships its beta program in-app: Google sign-in, live seat state, and waitlist routing are part of the real flow."
          />
        </div>
        <div className="self-center">
          <DeviceFrame>
            <div className="relative h-[860px] overflow-hidden bg-[#07090d]">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-[-8%] top-[-11rem] h-[26rem] rounded-full bg-[radial-gradient(circle,rgba(50,211,238,0.22),transparent_58%)] blur-3xl" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(50,211,238,0.14),transparent_34%),linear-gradient(180deg,#07090d_0%,#090b0f_42%,#05070a_100%)]" />
                <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:56px_56px]" />
              </div>
              <div className="relative flex h-full flex-col px-8 py-7">
                <div className="flex items-center justify-between gap-4">
                  <EdgeLabWordmark size="sm" />
                  <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300">
                    24 seats open
                  </div>
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <div className="w-full max-w-[880px] rounded-[38px] border border-white/10 bg-[#061018]/94 p-10 shadow-[0_20px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-50">
                      Secure beta access
                    </div>
                    <h2 className="mt-7 text-[64px] font-semibold leading-[0.98] tracking-[-0.06em] text-white">
                      Enter EdgeLab through Google.
                    </h2>
                    <p className="mt-4 max-w-[720px] text-lg leading-8 text-slate-300">
                      One Google sign-in. Approved beta users open workspace. Full seats move straight into queue.
                    </p>
                    <div className="mt-7 grid gap-3 sm:grid-cols-3">
                      {[
                        ["Access", "24 seats open"],
                        ["Queue", "81 queued"],
                        ["Mode", "Private beta"],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
                          <div className="mt-3 text-lg font-semibold text-white">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3.5 text-sm font-semibold text-slate-950">
                      Continue with Google
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </DeviceFrame>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SessionScene = () => {
  return (
    <AbsoluteFill className={`${CANVAS} px-20 py-16`}>
      <div className="mx-auto grid h-full w-full max-w-[1580px] grid-cols-[440px_minmax(0,1fr)] gap-12">
        <div className="self-center">
          <TitleCard
            eyebrow="Session Gateway"
            title="Choose strategy, market, timeframe, and replay window."
            body="EdgeLab opens on a strategy-first gateway, not a generic dashboard. Users resume old sessions or create a new replay from dataset-backed markets and rule-linked playbooks."
          />
        </div>
        <DeviceFrame>
          <ScaledViewport className="h-[900px]" scale={0.74} width={1400}>
            <div className="min-h-[1180px] bg-[#090b0f]">
              <SessionGateway
                datasets={datasets}
                isLoading={false}
                onCreateSession={noopCreateSession}
                onCreatePlaybook={async (payload) => ({
                  id: 99,
                  name: payload.name,
                  description: payload.description ?? null,
                  rules: payload.rules ?? null,
                  created_at: "2026-06-20T00:00:00Z",
                })}
                onDeleteSession={() => undefined}
                onLoadMoreSessions={() => undefined}
                onResumeSession={() => undefined}
                onUpdateSession={() => undefined}
                playbooks={playbooks}
                session={sessions[0] ?? null}
                sessions={sessions}
                sessionsHasMore={false}
                strategySummaries={[]}
                trades={trades}
                isLoadingMoreSessions={false}
              />
            </div>
          </ScaledViewport>
        </DeviceFrame>
      </div>
    </AbsoluteFill>
  );
};

const WorkspaceScene = ({ portrait = false }: { portrait?: boolean }) => {
  return (
    <AbsoluteFill className={`${CANVAS} ${portrait ? "px-10 py-10" : "px-20 py-16"}`}>
      <div className={`mx-auto grid h-full w-full ${portrait ? "max-w-[980px] grid-rows-[auto_1fr] gap-8" : "max-w-[1580px] grid-cols-[360px_minmax(0,1fr)] gap-10"}`}>
        <div className="self-center">
          <TitleCard
            eyebrow="Core Workflow"
            title="Replay. Review. Refine."
            body="The repo already includes a marketing demo that reuses real app components for replay, review, metrics, playbooks, and trade history. That becomes the centerpiece here."
          />
        </div>
        <DeviceFrame>
          <ScaledViewport
            className={portrait ? "h-[1450px]" : "h-[860px]"}
            scale={portrait ? 0.82 : 0.82}
            width={1320}
          >
            <div className="min-h-[980px] bg-[#090b0f]">
              <HeroDemo />
            </div>
          </ScaledViewport>
        </DeviceFrame>
      </div>
    </AbsoluteFill>
  );
};

const SurfaceScene = () => {
  return (
    <AbsoluteFill className={`${CANVAS} px-20 py-16`}>
      <div className="mx-auto grid h-full w-full max-w-[1580px] grid-cols-[310px_minmax(0,1fr)] gap-10">
        <div className="self-center">
          <TitleCard
            eyebrow="Workspace Breadth"
            title="Beyond backtests."
            body="The sidebar and workspace code confirm live watchlists, macro calendar, finance tracking, journal views, feedback capture, and app-data import/export as real user-facing surfaces."
          />
        </div>
        <div className="grid grid-cols-[244px_minmax(0,1fr)] gap-6">
          <DeviceFrame>
            <div className="h-[860px] overflow-hidden">
              <Sidebar activeView="live" collapsed={false} onNavigate={() => undefined} />
            </div>
          </DeviceFrame>
          <div className="grid gap-6">
            <div className="rounded-[32px] border border-white/10 bg-[#071018]/94 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
              <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-cyan-100/70">
                Verified In Workspace Views
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4">
                {[
                  ["Live Markets", "Provider-backed watchlists, live charts, and streaming / polling feeds."],
                  ["Economic Calendar", "Impact, currency, day, and event-type filtering with cached refresh."],
                  ["Journal", "Live sessions, missed setups, accounts, notes, strategies, and reports."],
                  ["Finance Tracker", "Payouts, deposits, prop-firm stages, and cashflow ledger."],
                  ["Feedback", "Screenshots, HAR diagnostics, and recent submission history."],
                  ["App Data", "Full workspace export / import bundle management."],
                ].map(([label, text]) => (
                  <div key={label} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                      {label}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{text}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(50,211,238,0.12),rgba(255,255,255,0.02))] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
              <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-cyan-100/70">
                Closing Message
              </div>
              <h3 className="mt-4 font-display text-[48px] font-semibold leading-[0.96] tracking-[-0.06em] text-white">
                Fewer tabs. More truth.
              </h3>
              <p className="mt-4 max-w-[780px] text-lg leading-8 text-slate-300">
                Every beat in this video comes from code that already exists in EdgeLab: beta access, replay, trading, review, live context, feedback, and data portability.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const OutroScene = () => {
  return (
    <AbsoluteFill className={`${CANVAS} justify-center px-24`}>
      <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center text-center">
        <EdgeLabWordmark align="center" size="hero" />
        <div className="mt-10 inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.24em] text-cyan-50">
          Beta Launch
        </div>
        <h2 className="mt-8 font-display text-[74px] font-semibold leading-[0.92] tracking-[-0.08em] text-white">
          Your Edge Engineered
        </h2>
        <p className="mt-5 max-w-[760px] text-[26px] leading-[1.6] text-slate-300">
          Replay price action, capture decisions, and review outcomes from one trading surface.
        </p>
        <div className="mt-10 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 font-data text-[28px] text-cyan-100 shadow-[0_0_28px_rgba(50,211,238,0.16)]">
          edgelab.co.in
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const EdgeLabBetaLaunch = ({ portrait = false }: { portrait?: boolean }) => {
  return (
    <AbsoluteFill className="bg-[#05070a] text-slate-100">
      <Sequence durationInFrames={210} from={0}>
        <IntroScene />
      </Sequence>
      <Sequence durationInFrames={270} from={210}>
        <AuthScene />
      </Sequence>
      <Sequence durationInFrames={330} from={480}>
        <SessionScene />
      </Sequence>
      <Sequence durationInFrames={660} from={810}>
        <WorkspaceScene portrait={portrait} />
      </Sequence>
      <Sequence durationInFrames={390} from={1470}>
        <SurfaceScene />
      </Sequence>
      <Sequence durationInFrames={300} from={1860}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};

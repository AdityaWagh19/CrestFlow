import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type Health, type PlatformStatus } from "@/lib/api";
import { fmtNum, fmtAlgo } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CrestFlow — Earn T-Bill yield on Algorand" },
      { name: "description", content: "Non-custodial treasury that converts your idle ALGO into tokenized T-Bill yield. Lock, invest, redeem — fully on-chain." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api<Health>("/health"),
      api<PlatformStatus>("/platform/status"),
    ]).then(([h, s]) => {
      if (h.status === "fulfilled") setHealth(h.value);
      if (s.status === "fulfilled") setStatus(s.value);
      if (h.status === "rejected" && s.status === "rejected") {
        setErr("Backend unreachable. Make sure the API is running.");
      }
    });
  }, []);

  return (
    <>
      {/* HERO */}
      <section className="section-y">
        <div className="container-editorial">
          <div className="mx-auto max-w-3xl text-center">
            <span className="badge mx-auto mb-6">
              <span className={`badge-dot ${health ? "" : "badge-dot-warn"}`} />
              {health
                ? `${health.network ?? "algorand"} · round ${fmtNum(health.round)}`
                : err ?? "Connecting to network…"}
            </span>
            <h1 className="text-balance text-[40px] font-normal leading-[1.05] tracking-tight text-[var(--ink)] md:text-[64px]">
              Earn institutional T-Bill yield<br className="hidden md:block" /> without giving up your keys.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-relaxed text-[var(--body)]">
              CrestFlow locks your ALGO in a non-custodial escrow, routes it into tokenized
              T-Bill positions, and returns principal plus yield on maturity — all on Algorand.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to="/connect" className="btn-primary">Connect wallet</Link>
              <Link to="/orders" className="btn-secondary">Browse orders</Link>
            </div>
          </div>

          {/* Stats strip */}
          <div className="mx-auto mt-16 grid max-w-5xl grid-cols-2 gap-px rounded-xl border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-4">
            <Stat label="Total orders" value={fmtNum(status?.total_orders)} />
            <Stat label="Active orders" value={fmtNum(status?.active_orders)} />
            <Stat label="Min order" value={status ? fmtAlgo(status.min_order_algo, 0) : "—"} />
            <Stat
              label="Escrow"
              value={status ? (status.escrow_active ? "Active" : "Paused") : "—"}
              tone={status && !status.escrow_active ? "warn" : "ok"}
            />
          </div>
        </div>
      </section>

      {/* SIGNATURE CORAL */}
      <section className="container-editorial pb-16">
        <div className="signature-card signature-coral">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-white/70">
                Non-custodial by design
              </span>
              <h2 className="mt-3 text-[32px] font-normal leading-tight text-white md:text-[40px]">
                Your wallet signs every state change.
              </h2>
              <p className="mt-4 text-[15px] text-white/85">
                No deposits to a centralized account. Funds move atomically between
                the escrow contract, the T-Bill program, and your wallet — verifiable
                on-chain at every step.
              </p>
              <Link to="/orders/new" className="btn-secondary mt-6 inline-flex">
                Create your first order
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniCard title="1. Lock" body="Sign an atomic group: payment + app-call." surface="bg-white/10 text-white/90 border-white/15" />
              <MiniCard title="2. Invest" body="Orchestrator buys tokenized T-Bill ASA." surface="bg-white/10 text-white/90 border-white/15" />
              <MiniCard title="3. Mature" body="Position redeems to ALGO at maturity." surface="bg-white/10 text-white/90 border-white/15" />
              <MiniCard title="4. Settle" body="Seller receives principal; yield to platform." surface="bg-white/10 text-white/90 border-white/15" />
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — editorial */}
      <section className="section-y">
        <div className="container-editorial">
          <div className="grid gap-12 md:grid-cols-12 md:gap-16">
            <div className="md:col-span-5">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                How it works
              </span>
              <h2 className="mt-3 text-[32px] font-normal leading-tight text-[var(--ink)] md:text-[40px]">
                A treasury workflow modeled like fixed income, not like DeFi.
              </h2>
              <p className="mt-4 text-[15px] text-[var(--body)]">
                Pick a lock window, see the live yield estimate, and submit a single signed
                group transaction. The orchestrator handles investment and redemption.
                You never relinquish custody.
              </p>
            </div>
            <ol className="space-y-6 md:col-span-7">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-5 border-t border-[var(--hairline)] pt-6 first:border-t-0 first:pt-0">
                  <div className="text-[13px] font-medium text-[var(--muted)] tabular-nums">
                    0{i + 1}
                  </div>
                  <div>
                    <h3 className="text-[18px] font-medium text-[var(--ink)]">{s.title}</h3>
                    <p className="mt-2 text-sm text-[var(--body)]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* TIER GRID — uneven heights */}
      <section className="container-editorial pb-16">
        <div className="mb-10 max-w-2xl">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Lock tiers</span>
          <h2 className="mt-3 text-[32px] font-normal leading-tight text-[var(--ink)]">
            Seven horizons. Same workflow.
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          {TIERS.map((t) => (
            <div key={t.label} className={`demo-card ${t.surface}`} style={{ minHeight: t.h }}>
              <div className="text-[13px] font-medium uppercase tracking-wider opacity-70">
                {t.label}
              </div>
              <div className="mt-2 text-[28px] font-normal leading-none text-[var(--ink)]">
                {t.days}d
              </div>
              <p className="mt-3 text-sm text-[var(--body)]">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DARK CTA */}
      <section className="container-editorial pb-16">
        <div className="signature-card signature-dark text-center">
          <h2 className="mx-auto max-w-2xl text-[32px] font-normal leading-tight text-white md:text-[40px]">
            The path to predictable on-chain yield.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] text-white/75">
            Bring a Pera Wallet, a few ALGO, and a lock window. We handle the rest.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/connect" className="btn-secondary">Connect wallet</Link>
            <Link to="/orders" className="text-sm text-white/80 underline-offset-4 hover:underline">
              See live orders →
            </Link>
          </div>
        </div>
      </section>

      {/* LIGHT CTA BANNER */}
      <section className="container-editorial pb-24">
        <div className="rounded-xl bg-[var(--surface-strong)] p-10 md:p-14">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-[28px] font-normal leading-tight text-[var(--ink)] md:text-[32px]">
                Start building with CrestFlow.
              </h2>
              <p className="mt-2 text-sm text-[var(--body)]">
                Open the dashboard or browse the public order book — no signup required.
              </p>
            </div>
            <Link to="/dashboard" className="btn-primary">Open dashboard</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="bg-[var(--canvas)] p-6">
      <div className="text-[12px] font-medium uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className={`mt-2 text-[24px] font-normal ${tone === "warn" ? "text-[var(--signature-coral)]" : "text-[var(--ink)]"}`}>
        {value}
      </div>
    </div>
  );
}

function MiniCard({ title, body, surface }: { title: string; body: string; surface: string }) {
  return (
    <div className={`rounded-[10px] border p-4 ${surface}`}>
      <div className="text-[13px] font-medium">{title}</div>
      <div className="mt-1 text-xs opacity-80">{body}</div>
    </div>
  );
}

const STEPS = [
  { title: "Connect your wallet", body: "Pera Wallet signs a one-time nonce; CrestFlow returns a 24-hour session token." },
  { title: "Estimate the yield", body: "Pick an amount and a lock window between 1 and 90 days. See the APY, total return, and platform split live." },
  { title: "Sign the order group", body: "Two transactions — payment and app-call — signed atomically. They settle as a single state change." },
  { title: "Track to maturity", body: "Watch the order move PENDING → INVESTED → REDEEMED → COMPLETED. Cancel anytime before investment." },
];

const TIERS = [
  { label: "Short",    days: 1,  body: "Overnight ladder for working capital.",          surface: "bg-[var(--signature-peach)] !border-transparent", h: 200 },
  { label: "Short",    days: 3,  body: "Three-day window for quick rotations.",           surface: "bg-[var(--canvas)]",                             h: 180 },
  { label: "Standard", days: 7,  body: "Weekly cadence — the most common tier.",          surface: "bg-[var(--signature-mint)] !border-transparent",  h: 220 },
  { label: "Standard", days: 14, body: "Two weeks for balanced positioning.",             surface: "bg-[var(--canvas)]",                             h: 190 },
  { label: "Extended", days: 30, body: "Monthly position; better effective APY.",         surface: "bg-[var(--signature-yellow)] !border-transparent",h: 210 },
  { label: "Extended", days: 60, body: "Two-month lock for treasury reserves.",           surface: "bg-[var(--canvas)]",                             h: 200 },
  { label: "Long",     days: 90, body: "Quarterly horizon. Maximum yield.",               surface: "bg-[var(--signature-mustard)] !border-transparent",h: 230 },
];

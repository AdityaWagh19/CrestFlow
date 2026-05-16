import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  api,
  type OrdersList,
  type PlatformConfig,
  type PlatformStats,
  type PlatformTiers,
} from "@/lib/api";
import { useAdminAuth } from "@/lib/auth";
import { fmtAlgo, fmtDate, fmtNum, fmtPct, shortAddr } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin console — CrestFlow" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading, login, logout, error: authErr } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Show loading spinner while Supabase checks existing session
  if (loading) {
    return (
      <div className="container-editorial section-y text-sm text-[var(--muted)]">
        Checking session…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <section className="section-y">
        <div className="container-editorial mx-auto max-w-md">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            Admin
          </span>
          <h1 className="mt-2 text-[36px] font-normal leading-tight text-[var(--ink)]">
            Sign in
          </h1>
          <p className="mt-3 text-sm text-[var(--body)]">
            Admin access is protected by Supabase email authentication.
            Your account must match the{" "}
            <code className="font-mono text-[var(--ink)]">ADMIN_EMAIL</code>{" "}
            configured on the backend.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setLoginErr(null);
              setSubmitting(true);
              try {
                await login(email, pw);
              } catch (err: any) {
                setLoginErr(err?.message ?? "Login failed");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink)]">
                Email
              </label>
              <input
                type="email"
                className="input-text"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink)]">
                Password
              </label>
              <input
                type="password"
                className="input-text"
                placeholder="••••••••"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
            {(loginErr || authErr) && (
              <p className="text-sm text-[var(--signature-coral)]">
                {loginErr ?? authErr}
              </p>
            )}
          </form>
        </div>
      </section>
    );
  }

  return <AdminConsole onLogout={logout} />;
}

function AdminConsole({ onLogout }: { onLogout: () => void }) {
  const { adminToken } = useAdminAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [tiers, setTiers] = useState<PlatformTiers | null>(null);
  const [orders, setOrders] = useState<OrdersList | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminToken) return;
    setErr(null);

    Promise.allSettled([
      // Admin-gated endpoints — send Supabase JWT
      api<PlatformStats>("/platform/stats", { jwt: adminToken }),
      api<PlatformConfig>("/platform/config", { jwt: adminToken }),
      api<PlatformTiers>("/platform/tiers", { jwt: adminToken }),
      // Orders: public endpoint but admin JWT unlocks yield_earned_algo + full fields
      api<OrdersList>("/orders?limit=200", { jwt: adminToken }),
    ]).then(([s, c, t, o]) => {
      if (s.status === "fulfilled") setStats(s.value);
      if (c.status === "fulfilled") setConfig(c.value);
      if (t.status === "fulfilled") setTiers(t.value);
      if (o.status === "fulfilled") setOrders(o.value);

      const fails = [s, c, t, o].filter(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult[];
      if (fails.length) {
        setErr(
          `${fails.length} admin endpoint${fails.length > 1 ? "s" : ""} returned an error. Check ADMIN_EMAIL and SUPABASE_JWT_SECRET on the backend.`,
        );
      }
    });
  }, [adminToken]);

  return (
    <section className="section-y">
      <div className="container-editorial space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Admin console
            </span>
            <h1 className="mt-2 text-[40px] font-normal leading-tight text-[var(--ink)]">
              Platform overview
            </h1>
          </div>
          <button onClick={onLogout} className="btn-secondary">
            Sign out
          </button>
        </header>

        {err && (
          <div className="rounded-[10px] border border-[var(--hairline)] bg-[var(--signature-cream)] p-4 text-sm text-[var(--ink)]">
            <strong className="font-medium">Backend error — </strong>
            {err}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-5 lg:grid-cols-3">
          <StatBlock title="Escrow" tone="dark">
            {stats?.escrow ? (
              <>
                <BigVal
                  value={fmtAlgo(stats.escrow.total_locked_algo)}
                  label="Total locked"
                  dark
                />
                <KV k="Released" v={fmtAlgo(stats.escrow.total_released_algo)} dark />
                <KV k="Total orders" v={fmtNum(stats.escrow.total_orders)} dark />
                <KV k="Active" v={fmtNum(stats.escrow.active_orders)} dark />
                <KV k="Min order" v={fmtAlgo(stats.escrow.min_order_algo, 0)} dark />
                <KV k="Paused" v={stats.escrow.paused ? "Yes" : "No"} dark />
              </>
            ) : (
              <Empty dark />
            )}
          </StatBlock>

          <StatBlock title="T-Bill" tone="cream">
            {stats?.tbill ? (
              <>
                <BigVal
                  value={fmtAlgo(stats.tbill.total_invested_algo)}
                  label="Total invested"
                />
                <KV k="Yield paid" v={fmtAlgo(stats.tbill.total_yield_paid_algo)} />
                <KV k="Active positions" v={fmtNum(stats.tbill.active_positions)} />
                <KV k="Yield rate" v={fmtPct(stats.tbill.yield_rate_pct)} />
                <KV k="Demo mode" v={stats.tbill.demo_mode ? "On" : "Off"} />
                <KV
                  k="Multiplier"
                  v={`${stats.tbill.demo_multiplier_sec ?? "—"}s`}
                />
              </>
            ) : (
              <Empty />
            )}
          </StatBlock>

          <StatBlock title="Platform" tone="default">
            {stats?.platform ? (
              <>
                <BigVal
                  value={fmtAlgo(stats.platform.total_yield_earned_algo)}
                  label="Total yield earned"
                />
                <KV
                  k="Wallet"
                  v={shortAddr(stats.platform.platform_wallet, 8)}
                  mono
                />
              </>
            ) : (
              <Empty />
            )}
          </StatBlock>
        </div>

        {/* Config */}
        {config && (
          <div className="rounded-[12px] border border-[var(--hairline)] p-6">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Configuration
            </div>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-[18px] font-medium text-[var(--ink)]">
                  Escrow contract
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <KV k="App ID" v={fmtNum(config.contracts?.escrow?.app_id)} />
                  <KV
                    k="Address"
                    v={shortAddr(config.contracts?.escrow?.address, 10)}
                    mono
                  />
                  <KV
                    k="Admin"
                    v={shortAddr(config.contracts?.escrow?.admin, 10)}
                    mono
                  />
                  <KV
                    k="Paused"
                    v={config.contracts?.escrow?.paused ? "Yes" : "No"}
                  />
                  {config.contracts?.escrow?.explorer && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--muted)]">Explorer</span>
                      <a
                        href={config.contracts.escrow.explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--link)] underline-offset-4 hover:underline"
                      >
                        Pera ↗
                      </a>
                    </div>
                  )}
                </dl>
              </div>
              <div>
                <h3 className="text-[18px] font-medium text-[var(--ink)]">
                  T-Bill contract
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <KV k="App ID" v={fmtNum(config.contracts?.tbill?.app_id)} />
                  <KV
                    k="Address"
                    v={shortAddr(config.contracts?.tbill?.address, 10)}
                    mono
                  />
                  <KV
                    k="Orchestrator"
                    v={shortAddr(config.contracts?.tbill?.orchestrator, 10)}
                    mono
                  />
                  <KV
                    k="Demo mode"
                    v={config.contracts?.tbill?.demo_mode ? "On" : "Off"}
                  />
                  {config.contracts?.tbill?.explorer && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--muted)]">Explorer</span>
                      <a
                        href={config.contracts.tbill.explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--link)] underline-offset-4 hover:underline"
                      >
                        Pera ↗
                      </a>
                    </div>
                  )}
                </dl>
              </div>
            </div>
            <div className="mt-6 pt-4 text-sm border-t border-[var(--hairline)]">
              <span className="text-[var(--muted)]">Network: </span>
              <span className="text-[var(--ink)]">
                {config.network} · round {fmtNum(config.round)}
              </span>
            </div>
            {config.asa_ids && (
              <div className="mt-4 text-sm">
                <span className="text-[var(--muted)]">T-Bill ASA IDs: </span>
                <span className="font-mono text-[var(--ink)]">
                  {Object.entries(config.asa_ids)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tiers */}
        {tiers && (
          <div>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-[24px] font-normal text-[var(--ink)]">
                Lock tiers
              </h2>
              {tiers.demo_mode && (
                <span className="badge">
                  <span className="badge-dot badge-dot-warn" />
                  Demo mode
                </span>
              )}
            </div>
            <div className="overflow-x-auto rounded-[12px] border border-[var(--hairline)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-soft)] text-left text-[12px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-5 py-3">Days</th>
                    <th className="px-5 py-3">Label</th>
                    <th className="px-5 py-3">Est. release</th>
                    <th className="px-5 py-3">Demo seconds</th>
                    <th className="px-5 py-3">Demo label</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.tiers?.map((t) => (
                    <tr key={t.days} className="border-t border-[var(--hairline)]">
                      <td className="px-5 py-3 font-mono text-[var(--ink)]">
                        {t.days}d
                      </td>
                      <td className="px-5 py-3">{t.lock_label}</td>
                      <td className="px-5 py-3">
                        {t.estimated_release_days ?? "—"}
                      </td>
                      <td className="px-5 py-3 tabular-nums">
                        {t.demo_maturity_seconds}s
                      </td>
                      <td className="px-5 py-3">{t.demo_maturity_label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Orders — full unmasked, clickable rows */}
        <div>
          <h2 className="mb-4 text-[24px] font-normal text-[var(--ink)]">
            All orders
          </h2>
          <div className="overflow-x-auto rounded-[12px] border border-[var(--hairline)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-soft)] text-left text-[12px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Buyer</th>
                  <th className="px-5 py-3">Seller</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Yield</th>
                  <th className="px-5 py-3">Eligible</th>
                  <th className="px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders?.orders.map((o) => (
                  <tr
                    key={o.order_id}
                    onClick={() =>
                      navigate({
                        to: "/orders/$id",
                        params: { id: String(o.order_id) },
                      })
                    }
                    className="cursor-pointer border-t border-[var(--hairline)] hover:bg-[var(--surface-soft)]"
                  >
                    <td className="px-5 py-3 font-mono">#{o.order_id}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-5 py-3 font-mono text-[var(--body)]">
                      {shortAddr(o.buyer)}
                    </td>
                    <td className="px-5 py-3 font-mono text-[var(--body)]">
                      {shortAddr(o.seller)}
                    </td>
                    <td className="px-5 py-3">{fmtAlgo(o.amount_algo)}</td>
                    <td className="px-5 py-3">
                      {o.yield_earned_algo != null
                        ? fmtAlgo(o.yield_earned_algo)
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {o.invest_eligible == null
                        ? "—"
                        : o.invest_eligible
                          ? "Yes"
                          : "No"}
                    </td>
                    <td className="px-5 py-3 text-[var(--muted)]">
                      {fmtDate(o.created_at)}
                    </td>
                  </tr>
                ))}
                {!orders?.orders.length && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-10 text-center text-[var(--muted)]"
                    >
                      No orders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "dark" | "cream" | "default";
  children: React.ReactNode;
}) {
  const cls =
    tone === "dark"
      ? "signature-card signature-dark"
      : tone === "cream"
        ? "signature-card signature-cream"
        : "rounded-[12px] border border-[var(--hairline)] bg-[var(--canvas)] p-8";
  return (
    <div className={cls}>
      <div
        className={`text-xs font-medium uppercase tracking-wider ${tone === "dark" ? "text-white/60" : "text-[var(--muted)]"}`}
      >
        {title}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function BigVal({
  value,
  label,
  dark,
}: {
  value: string;
  label: string;
  dark?: boolean;
}) {
  return (
    <div className="pb-4">
      <div
        className={`text-[36px] font-normal leading-none ${dark ? "text-white" : "text-[var(--ink)]"}`}
      >
        {value}
      </div>
      <div className={`mt-2 text-xs ${dark ? "text-white/60" : "text-[var(--muted)]"}`}>
        {label}
      </div>
    </div>
  );
}

function KV({
  k,
  v,
  dark,
  mono,
}: {
  k: string;
  v: string;
  dark?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={dark ? "text-white/60" : "text-[var(--muted)]"}>{k}</span>
      <span
        className={`${dark ? "text-white" : "text-[var(--ink)]"} ${mono ? "font-mono" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}

function Empty({ dark }: { dark?: boolean }) {
  return (
    <p className={`text-sm ${dark ? "text-white/50" : "text-[var(--muted)]"}`}>
      No data available.
    </p>
  );
}

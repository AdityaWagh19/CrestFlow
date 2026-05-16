import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, type AccountInfo, type AccountOrders, type PlatformStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtAlgo, fmtNum, fmtDate, shortAddr } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — CrestFlow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { address, isConnected } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [buyer, setBuyer] = useState<AccountOrders | null>(null);
  const [seller, setSeller] = useState<AccountOrders | null>(null);
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [tab, setTab] = useState<"buyer" | "seller">("buyer");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      const t = setTimeout(() => navigate({ to: "/connect" }), 0);
      return () => clearTimeout(t);
    }
  }, [isConnected, navigate]);

  useEffect(() => {
    if (!address) return;
    setErr(null);
    Promise.allSettled([
      api<AccountInfo>(`/account/${address}`),
      api<AccountOrders>(`/account/${address}/orders?role=buyer`),
      api<AccountOrders>(`/account/${address}/orders?role=seller`),
      api<PlatformStatus>("/platform/status"),
    ]).then(([a, b, s, p]) => {
      if (a.status === "fulfilled") setAccount(a.value); else setErr(a.reason?.message ?? "Account fetch failed");
      if (b.status === "fulfilled") setBuyer(b.value);
      if (s.status === "fulfilled") setSeller(s.value);
      if (p.status === "fulfilled") setStatus(p.value);
    });
  }, [address]);

  const orders = tab === "buyer" ? buyer : seller;

  if (!isConnected) {
    return (
      <section className="section-y">
        <div className="container-editorial text-center text-sm text-[var(--muted)]">
          Redirecting to connect…
        </div>
      </section>
    );
  }

  return (
    <section className="section-y">
      <div className="container-editorial space-y-10">
        {status && !status.escrow_active && (
          <div className="rounded-[10px] border border-[var(--hairline)] bg-[var(--signature-cream)] p-4 text-sm text-[var(--ink)]">
            <strong className="font-medium">Escrow paused.</strong> New orders are
            temporarily disabled. Existing orders continue to settle normally.
          </div>
        )}

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Dashboard
            </span>
            <h1 className="mt-2 text-[36px] font-normal leading-tight text-[var(--ink)]">
              Welcome back, <span className="font-mono text-[24px]">{shortAddr(address, 5)}</span>
            </h1>
          </div>
          <Link to="/orders/new" className="btn-primary">+ New order</Link>
        </header>

        {err && (
          <div className="rounded-[10px] border border-[var(--hairline)] bg-white p-4 text-sm text-[var(--signature-coral)]">
            {err}
          </div>
        )}

        {/* Wallet card + summary */}
        <div className="grid gap-5 md:grid-cols-3">
          <div className="signature-card signature-dark md:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wider text-white/60">Wallet</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-[44px] font-normal leading-none text-white">
                {fmtAlgo(account?.balance_algo, 4)}
              </span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-6 text-sm">
              <div>
                <div className="text-white/60">Spendable</div>
                <div className="mt-1 text-white">{fmtAlgo(account?.spendable_algo)}</div>
              </div>
              <div>
                <div className="text-white/60">Min reserved</div>
                <div className="mt-1 text-white">{fmtAlgo(account?.min_balance_algo)}</div>
              </div>
              <div>
                <div className="text-white/60">ASA holdings</div>
                <div className="mt-1 text-white">{fmtNum(account?.opted_in_assets ?? account?.assets?.length)}</div>
              </div>
            </div>
            {account?.explorer && (
              <a
                href={account.explorer}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-block text-sm text-white/80 underline-offset-4 hover:underline"
              >
                View on Pera Explorer ↗
              </a>
            )}
          </div>

          <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-soft)] p-6">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Order summary
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="As buyer" value={fmtNum(buyer?.total_orders)} />
              <Row label="As seller" value={fmtNum(seller?.total_orders)} />
              <Row label="Total transacted" value={fmtAlgo((buyer?.summary.total_transacted_algo ?? 0) + (seller?.summary.total_transacted_algo ?? 0))} />
            </dl>
            <div className="mt-5 hairline-row pt-4">
              <div className="text-xs uppercase tracking-wider text-[var(--muted)]">By status</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(() => {
                  const ALL_STATUSES = ["PENDING", "INVESTED", "REDEEMED", "COMPLETED", "CANCELLED"];
                  const combined = ALL_STATUSES.reduce<Record<string, number>>((acc, s) => {
                    const b = buyer?.summary.by_status?.[s] ?? 0;
                    const sel = seller?.summary.by_status?.[s] ?? 0;
                    const total = b + sel;
                    if (total > 0) acc[s] = total;
                    return acc;
                  }, {});
                  const entries = Object.entries(combined);
                  return entries.length
                    ? entries.map(([k, v]) => (
                        <span key={k} className="badge">{k} · {v}</span>
                      ))
                    : <span className="text-xs text-[var(--muted)]">—</span>;
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Recent orders */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-[24px] font-normal text-[var(--ink)]">Recent orders</h2>
            <div className="flex gap-1 rounded-full border border-[var(--hairline)] p-1 text-sm">
              {(["buyer", "seller"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setTab(r)}
                  className={`rounded-full px-4 py-1.5 capitalize ${tab === r ? "bg-[var(--primary)] text-white" : "text-[var(--body)]"}`}
                >
                  As {r}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-[12px] border border-[var(--hairline)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-soft)] text-left text-[12px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3">Order</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Counterparty</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders?.orders.length ? orders.orders.slice(0, 10).map((o) => (
                  <tr
                    key={o.order_id}
                    onClick={() => navigate({ to: "/orders/$id", params: { id: String(o.order_id) } })}
                    className="cursor-pointer border-t border-[var(--hairline)] hover:bg-[var(--surface-soft)]"
                  >
                    <td className="px-5 py-4 font-mono">#{o.order_id}</td>
                    <td className="px-5 py-4"><StatusBadge status={o.status} /></td>
                    <td className="px-5 py-4 font-mono text-[var(--body)]">
                      {tab === "buyer" ? shortAddr(o.seller) : shortAddr(o.buyer)}
                    </td>
                    <td className="px-5 py-4 text-[var(--ink)]">{fmtAlgo(o.amount_algo)}</td>
                    <td className="px-5 py-4 text-[var(--muted)]">{fmtDate(o.created_at)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-[var(--muted)]">
                      No orders yet. <Link to="/orders/new" className="text-[var(--link)] underline-offset-4 hover:underline">Create your first one →</Link>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-[var(--ink)]">{value}</dd>
    </div>
  );
}

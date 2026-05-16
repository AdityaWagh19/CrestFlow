import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type OrdersList } from "@/lib/api";
import { fmtAlgo, fmtDate, shortAddr } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "Order explorer — CrestFlow" }] }),
  component: OrdersIndex,
});

const STATUSES = ["", "PENDING", "INVESTED", "REDEEMED", "COMPLETED", "CANCELLED"];
const PAGE_SIZE = 25;

function OrdersIndex() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [buyer, setBuyer] = useState("");
  const [seller, setSeller] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<OrdersList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (status) params.set("status", status);
    if (buyer) params.set("buyer", buyer);
    if (seller) params.set("seller", seller);
    api<OrdersList>(`/orders?${params}`)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [status, buyer, seller, offset]);

  return (
    <section className="section-y">
      <div className="container-editorial space-y-8">
        <header className="max-w-2xl">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Order explorer</span>
          <h1 className="mt-2 text-[40px] font-normal leading-tight text-[var(--ink)]">
            Every order on the protocol.
          </h1>
          <p className="mt-3 text-[15px] text-[var(--body)]">
            Public, masked view of all orders. Filter by status or address. Click any row for the full lifecycle.
          </p>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-soft)] p-5">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-[var(--ink)]">Status</label>
            <select
              className="input-text"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
            </select>
          </div>
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs font-medium text-[var(--ink)]">Buyer address</label>
            <input
              className="input-text font-mono"
              placeholder="filter by buyer…"
              value={buyer}
              onChange={(e) => { setBuyer(e.target.value.trim()); setOffset(0); }}
            />
          </div>
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs font-medium text-[var(--ink)]">Seller address</label>
            <input
              className="input-text font-mono"
              placeholder="filter by seller…"
              value={seller}
              onChange={(e) => { setSeller(e.target.value.trim()); setOffset(0); }}
            />
          </div>
        </div>

        {err && <div className="rounded-[10px] border border-[var(--hairline)] bg-white p-4 text-sm text-[var(--signature-coral)]">{err}</div>}

        {/* Table */}
        <div className="overflow-x-auto rounded-[12px] border border-[var(--hairline)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-soft)] text-left text-[12px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Buyer</th>
                <th className="px-5 py-3">Seller</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[var(--muted)]">Loading…</td></tr>
              )}
              {!loading && data?.orders.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[var(--muted)]">No orders match those filters.</td></tr>
              )}
              {!loading && data?.orders.map((o) => (
                <tr
                  key={o.order_id}
                  onClick={() => navigate({ to: "/orders/$id", params: { id: String(o.order_id) } })}
                  className="cursor-pointer border-t border-[var(--hairline)] hover:bg-[var(--surface-soft)]"
                >
                  <td className="px-5 py-4 font-mono text-[var(--ink)]">#{o.order_id}</td>
                  <td className="px-5 py-4"><StatusBadge status={o.status} /></td>
                  <td className="px-5 py-4 font-mono text-[var(--body)]">{shortAddr(o.buyer)}</td>
                  <td className="px-5 py-4 font-mono text-[var(--body)]">{shortAddr(o.seller)}</td>
                  <td className="px-5 py-4 text-[var(--ink)]">{fmtAlgo(o.amount_algo)}</td>
                  <td className="px-5 py-4 text-[var(--muted)]">{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted)]">
              Showing {data.offset + 1}–{Math.min(data.offset + data.orders.length, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="btn-secondary !py-2 !px-3 !text-sm"
              >
                ← Prev
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={!data.has_more}
                className="btn-secondary !py-2 !px-3 !text-sm"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

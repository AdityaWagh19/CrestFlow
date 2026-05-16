import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type OrderDetail, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtAlgo, fmtDate, shortAddr, STATUS_TONE } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

interface TxStatus {
  txid: string;
  confirmed: boolean;
  confirmed_round: number | null;
  pool_error: string | null;
  explorer: string;
}

export const Route = createFileRoute("/orders/$id")({
  head: () => ({ meta: [{ title: "Order detail — CrestFlow" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    txid: typeof search.txid === "string" ? search.txid : undefined,
  }),
  component: OrderDetailPage,
});

function OrderDetailPage() {
  const { id } = Route.useParams();
  const { txid: submitTxid } = Route.useSearch();
  const { jwt, address, isConnected } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);

  // Verify submit txid on first load (passed as ?txid= from orders/new)
  useEffect(() => {
    if (!submitTxid) return;
    api<TxStatus>(`/tx/${submitTxid}`)
      .then(setTxStatus)
      .catch(() => {}); // non-critical — order polling will still work
  }, [submitTxid]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await api<OrderDetail>(`/orders/${id}`, { jwt });
        if (!active) return;
        setOrder(data);
        setErr(null);
        if (data.lifecycle?.is_active) {
          const interval =
            data.status === "PENDING" ? 15000 :
            data.status === "INVESTED" ? 30000 :
            data.status === "REDEEMED" ? 10000 : 30000;
          timer = setTimeout(tick, interval);
        }
      } catch (e: any) {
        if (!active) return;
        setErr(e?.message ?? "Order fetch failed");
      }
    };
    tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [id, jwt]);

  async function handleCancel() {
    if (!jwt || !order) return;
    setCancelling(true);
    setErr(null);
    try {
      await api(`/orders/${id}`, { method: "DELETE", jwt });
      // refetch
      const fresh = await api<OrderDetail>(`/orders/${id}`, { jwt });
      setOrder(fresh);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  const canCancel =
    isConnected &&
    order?.lifecycle?.is_active &&
    (order.status === "PENDING" || order.status === "REDEEMED") &&
    address === order.buyer;

  if (err && !order) {
    return (
      <div className="container-editorial section-y text-center">
        <p className="text-sm text-[var(--signature-coral)]">{err}</p>
        <Link to="/orders" className="btn-secondary mt-6 inline-flex">Back to orders</Link>
      </div>
    );
  }

  if (!order) {
    return <div className="container-editorial section-y text-sm text-[var(--muted)]">Loading order…</div>;
  }

  const tone = STATUS_TONE[order.status];

  return (
    <section className="section-y">
      <div className="container-editorial space-y-10">
        <Link to="/orders" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">← All orders</Link>

        {/* Transaction confirmation banner — shown only when arriving from submit */}
        {txStatus && (
          <div className={`rounded-[10px] border p-4 text-sm ${
            txStatus.confirmed
              ? "border-[var(--hairline)] bg-[var(--surface-soft)] text-[var(--ink)]"
              : "border-[var(--hairline)] bg-[var(--signature-cream)] text-[var(--ink)]"
          }`}>
            <span className="font-medium">
              {txStatus.confirmed
                ? `✓ Transaction confirmed on round ${txStatus.confirmed_round}`
                : "Transaction submitted — awaiting confirmation…"}
            </span>
            {txStatus.pool_error && (
              <span className="ml-2 text-[var(--signature-coral)]">
                Pool error: {txStatus.pool_error}
              </span>
            )}
            <a
              href={txStatus.explorer}
              target="_blank"
              rel="noreferrer"
              className="ml-4 text-[var(--link)] underline-offset-4 hover:underline"
            >
              View on Explorer ↗
            </a>
          </div>
        )}

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Order #{order.order_id}
            </span>
            <h1 className="mt-2 text-[40px] font-normal leading-tight text-[var(--ink)]">
              {fmtAlgo(order.amount_algo)}
            </h1>
            <p className="mt-2 text-sm text-[var(--body)]">{tone?.label ?? order.status}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={order.status} />
            {canCancel && (
              <button onClick={handleCancel} disabled={cancelling} className="btn-secondary">
                {cancelling ? "Cancelling…" : "Cancel order"}
              </button>
            )}
          </div>
        </header>

        {err && (
          <div className="rounded-[10px] border border-[var(--hairline)] bg-white p-4 text-sm text-[var(--signature-coral)]">
            {err}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--canvas)]">
              <div className="border-b border-[var(--hairline)] px-6 py-4 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                Order details
              </div>
              <dl className="divide-y divide-[var(--hairline)] px-6 text-sm">
                <Row k="Buyer" v={shortAddr(order.buyer, 8)} mono />
                <Row k="Seller" v={shortAddr(order.seller, 8)} mono />
                <Row k="Amount" v={fmtAlgo(order.amount_algo)} />
                <Row k="Created" v={fmtDate(order.created_at)} />
                <Row k="Lock until" v={fmtDate(order.lock_until)} />
                <Row k="Estimated release" v={fmtDate(order.estimated_release_ts)} />
                {order.description && <Row k="Description" v={order.description} />}
              </dl>
            </div>

            {order.tbill_position && (
              <div className="mt-5 signature-card signature-cream">
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--ink)]/60">
                  T-Bill position
                </div>
                <h3 className="mt-2 text-[24px] font-normal text-[var(--ink)]">
                  {order.tbill_position.tbill_label}
                </h3>
                <dl className="mt-5 space-y-3 text-sm">
                  <CreamRow k="Principal" v={fmtAlgo(order.tbill_position.principal_algo)} />
                  <CreamRow k="Invested at" v={fmtDate(order.tbill_position.invested_at_iso)} />
                  <CreamRow k="Maturity" v={fmtDate(order.tbill_position.maturity_iso)} />
                  <CreamRow k="Status" v={order.tbill_position.status ?? "—"} />
                  {typeof order.tbill_position.seconds_until_maturity === "number" && (
                    <CreamRow k="Time to maturity" v={`${Math.max(0, order.tbill_position.seconds_until_maturity)}s`} />
                  )}
                </dl>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-soft)] p-5">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Lifecycle</div>
              <ol className="mt-4 space-y-3 text-sm">
                {["PENDING", "INVESTED", "REDEEMED", "COMPLETED"].map((s, i) => {
                  const reached = ["PENDING","INVESTED","REDEEMED","COMPLETED"].indexOf(order.status) >= i;
                  const current = order.status === s;
                  return (
                    <li key={s} className="flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${current ? "bg-[var(--primary)]" : reached ? "bg-[var(--success-border)]" : "bg-[var(--hairline)]"}`} />
                      <span className={current ? "font-medium text-[var(--ink)]" : reached ? "text-[var(--body)]" : "text-[var(--muted)]"}>{s}</span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {order.links && (
              <div className="rounded-[12px] border border-[var(--hairline)] p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Explorers</div>
                <ul className="mt-3 space-y-2 text-sm">
                  {order.links.buyer_explorer && <ExLink href={order.links.buyer_explorer} label="Buyer" />}
                  {order.links.seller_explorer && <ExLink href={order.links.seller_explorer} label="Seller" />}
                  {order.links.escrow_explorer && <ExLink href={order.links.escrow_explorer} label="Escrow" />}
                  {order.links.tbill_explorer && <ExLink href={order.links.tbill_explorer} label="T-Bill ASA" />}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-4">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className={`col-span-2 text-[var(--ink)] ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
function CreamRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-t border-[var(--ink)]/10 pt-3 first:border-t-0 first:pt-0">
      <dt className="text-[var(--ink)]/70">{k}</dt>
      <dd className="text-[var(--ink)]">{v}</dd>
    </div>
  );
}
function ExLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a href={href} target="_blank" rel="noreferrer" className="text-[var(--link)] underline-offset-4 hover:underline">
        {label} on Pera Explorer ↗
      </a>
    </li>
  );
}

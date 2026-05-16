import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type EstimateResponse, type PrepareResponse, type SubmitResponse, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { signOrderTxnGroup } from "@/lib/pera";
import { fmtAlgo, fmtPct } from "@/lib/format";

export const Route = createFileRoute("/orders/new")({
  head: () => ({ meta: [{ title: "New order — CrestFlow" }] }),
  component: NewOrderPage,
});

const LOCK_DAYS = [1, 3, 7, 14, 30, 60, 90];

function NewOrderPage() {
  const { isConnected, address, jwt } = useAuth();
  const navigate = useNavigate();

  const [amount, setAmount] = useState<number>(10);
  const [lockDays, setLockDays] = useState<number>(7);
  const [seller, setSeller] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);

  const [phase, setPhase] = useState<"form" | "review" | "signing" | "submitting" | "done">("form");
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResponse | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      const t = setTimeout(() => navigate({ to: "/connect" }), 0);
      return () => clearTimeout(t);
    }
  }, [isConnected, navigate]);

  // Live estimate (debounced)
  useEffect(() => {
    if (!amount || !lockDays) return;
    setEstErr(null);
    const t = setTimeout(() => {
      api<EstimateResponse>(`/orders/estimate?amount_algo=${amount}&lock_days=${lockDays}`)
        .then(setEstimate)
        .catch((e) => setEstErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [amount, lockDays]);

  const sellerInvalid = seller.length > 0 && (seller.length < 50 || seller.length > 70);
  const sameAsBuyer = seller && seller === address;
  const canPrepare = amount >= 5 && lockDays && seller && !sellerInvalid && !sameAsBuyer;

  async function handlePrepare() {
    if (!jwt) return;
    setSubmitErr(null);
    try {
      const res = await api<PrepareResponse>("/orders/prepare", {
        method: "POST",
        jwt,
        body: JSON.stringify({ seller_address: seller, amount_algo: amount, lock_days: lockDays }),
      });
      setPrepared(res);
      setPhase("review");
    } catch (e: any) {
      setSubmitErr(e.message);
    }
  }

  async function handleSign() {
    if (!prepared || !jwt) return;
    setSubmitErr(null);
    setPhase("signing");
    try {
      const signed = await signOrderTxnGroup(prepared.unsigned_txns);
      setPhase("submitting");
      const res = await api<SubmitResponse>("/orders/submit", {
        method: "POST",
        jwt,
        body: JSON.stringify({
          signed_txns: signed,
          order_id: prepared.order_id,
          description: description.trim() || undefined,
        }),
      });
      setSubmitted(res);
      setPhase("done");
      setTimeout(
        () =>
          navigate({
            to: "/orders/$id",
            params: { id: String(prepared.order_id) },
            search: res.txid ? { txid: res.txid } : {},
          }),
        1500,
      );
    } catch (e: any) {
      setSubmitErr(e instanceof ApiError ? e.message : (e?.message ?? "Signing failed"));
      setPhase("review");
    }
  }

  if (!isConnected) {
    return <div className="container-editorial section-y text-sm text-[var(--muted)]">Redirecting…</div>;
  }

  return (
    <section className="section-y">
      <div className="container-editorial">
        <div className="mb-10">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">New order</span>
          <h1 className="mt-2 text-[40px] font-normal leading-tight text-[var(--ink)]">
            Lock ALGO. Earn yield. Settle on-chain.
          </h1>
        </div>

        <div className="grid items-start gap-8 md:grid-cols-12">
          {/* FORM */}
          <div className="md:col-span-7">
            <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--canvas)] p-8">
              {phase === "form" && (
                <>
                  <Field label="Amount (ALGO)">
                    <input
                      type="number"
                      min={1}
                      step={0.1}
                      className="input-text"
                      value={amount}
                      onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    />
                    {amount < 5 && (
                      <p className="mt-2 text-xs text-[var(--signature-coral)]">
                        Minimum 5 ALGO required for investment eligibility.
                      </p>
                    )}
                  </Field>

                  <Field label="Lock window">
                    <div className="flex flex-wrap gap-2">
                      {LOCK_DAYS.map((d) => (
                        <button
                          key={d}
                          onClick={() => setLockDays(d)}
                          className={`rounded-full border px-4 py-2 text-sm transition ${
                            lockDays === d
                              ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                              : "border-[var(--hairline)] bg-[var(--canvas)] text-[var(--ink)]"
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Seller address">
                    <input
                      type="text"
                      className="input-text font-mono"
                      placeholder="ALGORAND_ADDRESS_58_CHARS…"
                      value={seller}
                      onChange={(e) => setSeller(e.target.value.trim())}
                    />
                    {sellerInvalid && <p className="mt-2 text-xs text-[var(--signature-coral)]">Invalid address length.</p>}
                    {sameAsBuyer && <p className="mt-2 text-xs text-[var(--signature-coral)]">Buyer and seller must differ.</p>}
                  </Field>

                  <Field label="Description (optional)">
                    <input
                      type="text"
                      className="input-text"
                      placeholder="Trade note, reference, or purpose…"
                      maxLength={200}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {description.length}/200 — stored on-chain metadata (optional)
                    </p>
                  </Field>

                  <button
                    onClick={handlePrepare}
                    disabled={!canPrepare}
                    className="btn-primary mt-2 w-full md:w-auto"
                  >
                    Review order
                  </button>
                  {submitErr && (
                    <p className="mt-4 text-sm text-[var(--signature-coral)]">{submitErr}</p>
                  )}
                </>
              )}

              {phase === "review" && prepared && (
                <ReviewBlock
                  prepared={prepared}
                  onConfirm={handleSign}
                  onBack={() => setPhase("form")}
                  err={submitErr}
                />
              )}

              {(phase === "signing" || phase === "submitting") && (
                <div className="py-12 text-center">
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--hairline)] border-t-[var(--primary)]" />
                  <p className="mt-4 text-sm text-[var(--body)]">
                    {phase === "signing" ? "Sign the atomic group in Pera Wallet…" : "Submitting to the network…"}
                  </p>
                </div>
              )}

              {phase === "done" && submitted && (
                <div className="text-center py-8">
                  <span className="badge mx-auto"><span className="badge-dot" />Submitted</span>
                  <h3 className="mt-4 text-[24px] font-normal text-[var(--ink)]">Order is live.</h3>
                  <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">txid: {submitted.txid}</p>
                  <p className="mt-4 text-sm text-[var(--body)]">Redirecting to order details…</p>
                </div>
              )}
            </div>
          </div>

          {/* ESTIMATE PANEL */}
          <div className="md:col-span-5">
            <div className="signature-card signature-cream">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--ink)]/60">
                Live estimate
              </div>
              {estErr ? (
                <p className="mt-4 text-sm text-[var(--signature-coral)]">{estErr}</p>
              ) : estimate ? (
                <>
                  <div className="mt-3 flex items-baseline gap-3">
                    <span className="text-[44px] font-normal leading-none text-[var(--ink)]">
                      {fmtPct(estimate.apy_pct, 2)}
                    </span>
                    <span className="text-sm text-[var(--ink)]/70">APY · {estimate.tier}</span>
                  </div>

                  <dl className="mt-6 space-y-3 text-sm">
                    <Row k="Estimated yield" v={fmtAlgo(estimate.estimated_yield_algo)} />
                    <Row k="Total return" v={fmtAlgo(estimate.total_return_algo)} />
                    <Row k="Seller receives" v={fmtAlgo(estimate.seller_receives_algo)} />
                    <Row k="Platform fee" v={fmtAlgo(estimate.platform_receives_algo)} />
                    <Row k="Demo maturity" v={estimate.demo_maturity_label} />
                  </dl>

                  {!estimate.invest_eligible && (
                    <p className="mt-5 rounded-md bg-white/60 p-3 text-xs text-[var(--ink)]">
                      Below the 5 ALGO minimum — the order will be created but not invested.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-4 text-sm text-[var(--ink)]/60">Enter an amount to see the estimate.</p>
              )}
            </div>

            <p className="mt-4 text-xs text-[var(--muted)]">
              Estimates use the live tier table from the orchestrator. Final yield depends on
              actual T-Bill maturity timing.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <label className="mb-2 block text-[13px] font-medium text-[var(--ink)]">{label}</label>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-t border-[var(--ink)]/10 pt-3 first:border-t-0 first:pt-0">
      <dt className="text-[var(--ink)]/70">{k}</dt>
      <dd className="text-[var(--ink)]">{v}</dd>
    </div>
  );
}

function ReviewBlock({
  prepared, onConfirm, onBack, err,
}: { prepared: PrepareResponse; onConfirm: () => void; onBack: () => void; err: string | null }) {
  const d = prepared.details;
  return (
    <>
      <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Review & sign</span>
      <h3 className="mt-2 text-[24px] font-normal text-[var(--ink)]">Order #{prepared.order_id}</h3>

      <dl className="mt-6 space-y-3 text-sm">
        <Row k="Amount" v={fmtAlgo(d.amount_algo)} />
        <Row k="Lock window" v={`${d.lock_days} days · ${d.tier}`} />
        <Row k="Estimated yield" v={fmtAlgo(d.estimated_yield_algo)} />
        <Row k="Total return" v={fmtAlgo(d.total_return_algo)} />
        <Row k="Seller" v={d.seller.slice(0, 8) + "…" + d.seller.slice(-6)} />
        <Row k="Escrow" v={prepared.escrow_address.slice(0, 8) + "…" + prepared.escrow_address.slice(-6)} />
      </dl>

      <p className="mt-6 rounded-md bg-[var(--surface-soft)] p-3 text-xs text-[var(--body)]">
        You'll sign 2 transactions as a single atomic group: a payment to escrow + an app-call to record the order.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={onConfirm} className="btn-primary">Sign with Pera</button>
        <button onClick={onBack} className="btn-secondary">Back</button>
      </div>
      {err && <p className="mt-4 text-sm text-[var(--signature-coral)]">{err}</p>}
    </>
  );
}

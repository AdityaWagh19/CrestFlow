import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect wallet — CrestFlow" },
      { name: "description", content: "Connect your Pera Wallet and sign a one-time nonce to start using CrestFlow." },
    ],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  const { connect, isConnected, address, error, disconnect } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function handleConnect() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await connect();
      navigate({ to: "/dashboard" });
    } catch {
      // error is surfaced via auth.error
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="section-y">
      <div className="container-editorial grid items-start gap-12 md:grid-cols-12">
        {/* Left: instructions */}
        <div className="md:col-span-5">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            Step 1 of 1
          </span>
          <h1 className="mt-3 text-[40px] font-normal leading-tight text-[var(--ink)]">
            Connect your wallet.
          </h1>
          <p className="mt-4 text-[15px] text-[var(--body)]">
            CrestFlow uses a non-custodial, signature-based session. Your wallet signs a
            random nonce — we never see your private key, and there's no password to remember.
          </p>

          <ol className="mt-8 space-y-5 border-t border-[var(--hairline)] pt-6">
            {[
              "Click the button — a Pera Wallet connection modal will appear.",
              "Approve the connection in your Pera Wallet (phone or extension).",
              "Sign the one-time nonce message to prove wallet ownership.",
              "You'll receive a 24-hour session token scoped to your address.",
            ].map((s, i) => (
              <li key={i} className="flex gap-4">
                <span className="mt-0.5 shrink-0 text-[13px] font-medium tabular-nums text-[var(--muted)]">0{i + 1}</span>
                <span className="text-sm text-[var(--body)]">{s}</span>
              </li>
            ))}
          </ol>

          {/* Install Pera */}
          <div className="mt-8 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-soft)] p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Don't have Pera Wallet yet?
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <a
                href="https://chrome.google.com/webstore/detail/pera-wallet/eachfanldnefdpbfkigbfdchmijfbbde"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-[var(--link)] underline-offset-4 hover:underline"
              >
                Install Pera Chrome Extension ↗
              </a>
              <a
                href="https://perawallet.app"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-[var(--link)] underline-offset-4 hover:underline"
              >
                Download Pera Mobile App ↗
              </a>
            </div>
          </div>
        </div>

        {/* Right: connect card */}
        <div className="md:col-span-7">
          <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-soft)] p-8 md:p-10">
            {isConnected ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="badge"><span className="badge-dot" />Connected</span>
                </div>
                <div className="mt-4 break-all text-[14px] text-[var(--body)]">
                  <span className="text-[var(--muted)]">Address: </span>
                  <span className="font-mono text-[var(--ink)]">{address}</span>
                </div>
                <p className="mt-4 text-sm text-[var(--body)]">
                  Your session is active for the next 24 hours.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to="/dashboard" className="btn-primary">Go to dashboard</Link>
                  <button onClick={() => disconnect()} className="btn-secondary">Disconnect</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-[20px] font-medium text-[var(--ink)]">Pera Wallet</h3>
                <p className="mt-2 text-sm text-[var(--body)]">
                  Requires the{" "}
                  <a
                    href="https://chrome.google.com/webstore/detail/pera-wallet/eachfanldnefdpbfkigbfdchmijfbbde"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--link)] underline-offset-4 hover:underline"
                  >
                    Pera Chrome extension
                  </a>
                  {" "}or the{" "}
                  <a
                    href="https://perawallet.app"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--link)] underline-offset-4 hover:underline"
                  >
                    Pera mobile app
                  </a>
                  . A QR code will appear — scan it or approve in the extension.
                </p>

                <button
                  onClick={handleConnect}
                  className="btn-primary mt-6 w-full md:w-auto"
                  style={busy ? { opacity: 0.7 } : undefined}
                >
                  {busy ? "Waiting for wallet…" : "Connect Pera Wallet"}
                </button>

                {busy && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-center gap-3 text-sm text-[var(--body)]">
                      <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--hairline)] border-t-[var(--primary)]" />
                      <span>Pera Wallet modal opened — approve the connection, then sign the nonce.</span>
                    </div>
                    <p className="text-xs text-[var(--muted)]">
                      Desktop: approve in the Pera Chrome extension. Mobile: scan the QR with Pera Wallet.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="mt-6 rounded-[10px] border border-[var(--hairline)] bg-white p-4">
                    <p className="text-sm font-medium text-[var(--signature-coral)]">Connection failed</p>
                    <p className="mt-1 text-sm text-[var(--body)]">{error}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Make sure Pera Wallet is installed and unlocked, then try again.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

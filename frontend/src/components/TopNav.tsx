import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { shortAddr } from "@/lib/format";
import { Waves } from "lucide-react";
export function TopNav() {
  const { isConnected, address, disconnect, connecting } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[var(--canvas)]/95 backdrop-blur">
      <div className="container-editorial flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--canvas)] shadow-sm">
            <Waves className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-medium tracking-tight text-[var(--ink)]">
            CrestFlow
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <Link to="/" className="text-sm text-[var(--body)] [&.active]:text-[var(--ink)]" activeOptions={{ exact: true }}>
            Home
          </Link>
          <Link to="/orders" className="text-sm text-[var(--body)] [&.active]:text-[var(--ink)]">
            Orders
          </Link>
          <Link to="/dashboard" className="text-sm text-[var(--body)] [&.active]:text-[var(--ink)]">
            Dashboard
          </Link>
          <Link to="/admin" className="text-sm text-[var(--body)] [&.active]:text-[var(--ink)]">
            Admin
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="badge hidden sm:inline-flex">
                <span className="badge-dot" />
                {shortAddr(address)}
              </span>
              <button onClick={disconnect} className="btn-secondary !py-2 !px-3 !text-sm">
                Disconnect
              </button>
            </>
          ) : (
            <Link to="/connect" className="btn-primary !py-2.5 !px-4 !text-sm">
              {connecting ? "Connecting…" : "Connect wallet"}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

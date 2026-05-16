export function shortAddr(addr?: string | null, n = 6): string {
  if (!addr) return "—";
  if (addr.length <= n * 2 + 3) return addr;
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function fmtAlgo(n: number | undefined | null, digits = 4): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })} ALGO`;
}

export function fmtNum(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtDate(v: string | number | undefined | null): string {
  if (!v) return "—";
  const d = typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)) : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STATUS_TONE: Record<string, { dot: string; label: string }> = {
  PENDING:   { dot: "badge-dot-warn", label: "Awaiting investment" },
  INVESTED:  { dot: "badge-dot",      label: "Earning yield" },
  REDEEMED:  { dot: "badge-dot-warn", label: "Completing" },
  COMPLETED: { dot: "badge-dot",      label: "Completed" },
  CANCELLED: { dot: "badge-dot-err",  label: "Refunded" },
};

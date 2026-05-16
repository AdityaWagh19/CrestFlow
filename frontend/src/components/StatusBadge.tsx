import { STATUS_TONE } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? { dot: "badge-dot", label: status };
  return (
    <span className="badge">
      <span className={`badge-dot ${tone.dot}`} />
      <span className="font-medium">{status}</span>
      <span className="text-[var(--muted)]">· {tone.label}</span>
    </span>
  );
}

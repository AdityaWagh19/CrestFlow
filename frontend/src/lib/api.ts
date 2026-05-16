// CrestFlow REST API client. Backend runs at VITE_API_URL (default localhost:3001).
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Opts = RequestInit & { jwt?: string | null };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const { jwt, headers, ...rest } = opts;
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string> | undefined),
  };
  if (jwt) h["Authorization"] = `Bearer ${jwt}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers: h });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body && (body as any).error) ||
      (body && typeof body === "object" && "message" in body && (body as any).message) ||
      `HTTP ${res.status}`;
    throw new ApiError(res.status, String(msg), body);
  }
  return body as T;
}

// ---------- Typed helpers ----------

export interface Health {
  status: string;
  network?: string;
  round?: number;
  escrow_app?: number;
  tbill_app?: number;
}

export interface PlatformStatus {
  network?: string;
  escrow_active: boolean;
  total_orders: number;
  active_orders: number;
  min_order_algo: number;
}

export interface EstimateResponse {
  amount_algo: number;
  lock_days: number;
  tier: string;
  tier_days: number;
  apy_pct: number;
  estimated_yield_algo: number;
  total_return_algo: number;
  invest_eligible: boolean;
  demo_maturity_sec: number;
  demo_maturity_label: string;
  seller_receives_algo: number;
  platform_receives_algo: number;
}

export interface OrderRow {
  order_id: number;
  status: string;
  buyer: string;
  seller: string;
  amount_algo: number;
  lock_until?: string | number;
  created_at?: string;
  yield_earned_algo?: number;
  status_code?: number;
  invest_eligible?: boolean;
}

export interface OrdersList {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  orders: OrderRow[];
}

export interface OrderDetail extends OrderRow {
  description?: string;
  estimated_release_ts?: string | number;
  lifecycle: { is_active: boolean; is_complete: boolean };
  links?: {
    buyer_explorer?: string;
    seller_explorer?: string;
    escrow_explorer?: string;
    tbill_explorer?: string;
  };
  tbill_position?: {
    principal_algo: number;
    tbill_label: string;
    maturity_iso?: string;
    maturity_timestamp?: number;
    invested_at_iso?: string;
    status?: string;
    is_matured?: boolean;
    seconds_until_maturity?: number;
  };
}

export interface PrepareResponse {
  order_id: number;
  unsigned_txns: [string, string];
  escrow_address: string;
  details: {
    buyer: string;
    seller: string;
    amount_algo: number;
    amount_microalgo: number;
    lock_days: number;
    tier: string;
    tier_days: number;
    lock_rounds: number;
    estimated_yield_algo: number;
    total_return_algo: number;
    invest_eligible: boolean;
    demo_maturity_sec: number;
    seller_receives_algo: number;
    platform_receives_algo: number;
  };
  signing_instructions?: Record<string, string>;
}

export interface SubmitResponse {
  txid: string;
  confirmed_round?: number;
  message?: string;
  next_steps?: { monitor?: string; explorer?: string };
}

export interface AccountInfo {
  address: string;
  balance_algo: number;
  spendable_algo: number;
  min_balance_algo: number;
  opted_in_assets?: number;
  assets?: { asa_id: number; amount: number }[];
  status?: string;
  explorer?: string;
}

export interface AccountOrders {
  total_orders: number;
  summary: {
    by_status: Record<string, number>;
    total_transacted_algo: number;
  };
  orders: OrderRow[];
}

export interface NonceResponse {
  nonce: string;
  expires_at: string;
  expires_in_seconds: number;
  message: string;
}

export interface VerifyResponse {
  token: string;
  address: string;
  expires_in_seconds: number;
  message: string;
}

export interface PlatformStats {
  escrow: Record<string, any>;
  tbill: Record<string, any>;
  platform: Record<string, any>;
}

export interface PlatformConfig {
  network: string;
  round: number;
  contracts: {
    escrow: Record<string, any>;
    tbill: Record<string, any>;
  };
  platform_wallet?: string;
  min_order_algo?: number;
  valid_lock_days: number[];
  asa_ids: Record<string, number>;
}

export interface TierRow {
  days: number;
  lock_label: string;
  estimated_release_days?: number;
  demo_maturity_seconds: number;
  demo_maturity_label: string;
  apy_pct?: number;
}

export interface PlatformTiers {
  demo_mode: boolean;
  tiers: TierRow[];
}

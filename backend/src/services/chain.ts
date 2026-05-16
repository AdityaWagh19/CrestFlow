/**
 * Chain Service — on-chain reads for Escrow and TBill contracts.
 * Handles all decoding of AVM global state and box storage.
 */
import algosdk from "algosdk";
import { algodClient, ESCROW_APP_ID, TBILL_APP_ID } from "../config";

// ── Type Definitions ─────────────────────────────────────────────────────────

export const STATUS_LABELS = ["PENDING", "INVESTED", "REDEEMED", "COMPLETED", "CANCELLED", "DISPUTED"];

export interface DecodedOrder {
  buyer:            string;
  seller:           string;
  amount:           number;   // microALGO
  amount_algo:      number;
  created_at:       number;   // round
  lock_until:       number;   // round
  status:           string;
  status_code:      number;
  invest_eligible:  boolean;
  yield_earned:     number;   // microALGO
  yield_earned_algo: number;
  description?:     string;   // optional buyer-entered trade note (stored in Supabase)
}

export interface DecodedPosition {
  principal:          number;  // microALGO
  principal_algo:     number;
  tbill_type:         number;  // days
  tbill_label:        string;
  maturity_timestamp: number;  // unix seconds
  maturity_iso:       string;
  invested_at:        number;
  invested_at_iso:    string;
  status:             string;
  is_matured:         boolean;
  seconds_until_maturity: number;
}

export interface EscrowGlobalState {
  admin:                string;
  treasury_app_id:      number;
  treasury_address:     string;
  platform_wallet:      string;
  total_locked:         number;
  total_released:       number;
  total_orders:         number;
  active_orders:        number;
  min_order_amount:     number;
  default_lock_duration: number;
  paused:               boolean;
}

export interface TBillGlobalState {
  admin:            string;
  orchestrator:     string;
  escrow_app_id:    number;
  yield_rate_bps:   number;
  yield_rate_pct:   number;
  demo_mode:        boolean;
  demo_multiplier:  number;
  total_invested:   number;
  total_yield_paid: number;
  active_positions: number;
  paused:           boolean;
  asa_ids: {
    "1D": number; "3D": number; "7D": number; "14D": number;
    "30D": number; "60D": number; "90D": number;
  };
}

// ── Box Key Builders ─────────────────────────────────────────────────────────

export function orderBoxKey(orderId: number): Uint8Array {
  const key = Buffer.alloc(14); // "orders"(6) + uint64(8)
  Buffer.from("orders").copy(key, 0);
  key.writeBigUInt64BE(BigInt(orderId), 6);
  return key;
}

export function positionBoxKey(orderId: number): Uint8Array {
  const key = Buffer.alloc(17); // "positions"(9) + uint64(8)
  Buffer.from("positions").copy(key, 0);
  key.writeBigUInt64BE(BigInt(orderId), 9);
  return key;
}

// ── Struct Decoders ──────────────────────────────────────────────────────────

/**
 * OrderRecord struct (98 bytes):
 *   buyer(32) seller(32) amount(8) created_at(8) lock_until(8)
 *   status(1) invest_eligible(1) yield_earned(8)
 */
export function decodeOrder(value: Uint8Array): DecodedOrder {
  const b = Buffer.from(value);
  const statusCode = b[88];
  // ARC4 Bool is MSB-encoded: 0x80 = True, 0x00 = False
  const investEligible = (b[89] & 0x80) !== 0;
  return {
    buyer:           algosdk.encodeAddress(b.subarray(0, 32)),
    seller:          algosdk.encodeAddress(b.subarray(32, 64)),
    amount:          Number(b.readBigUInt64BE(64)),
    amount_algo:     Number(b.readBigUInt64BE(64)) / 1e6,
    created_at:      Number(b.readBigUInt64BE(72)),
    lock_until:      Number(b.readBigUInt64BE(80)),
    status:          STATUS_LABELS[statusCode] ?? `UNKNOWN(${statusCode})`,
    status_code:     statusCode,
    invest_eligible: investEligible,
    yield_earned:    Number(b.readBigUInt64BE(90)),
    yield_earned_algo: Number(b.readBigUInt64BE(90)) / 1e6,
  };
}

/**
 * TBillPosition struct (26 bytes):
 *   principal(8) tbill_type(1) maturity_timestamp(8) invested_at(8) status(1)
 */
export function decodePosition(value: Uint8Array): DecodedPosition {
  const b       = Buffer.from(value);
  const principal = Number(b.readBigUInt64BE(0));
  const days      = b[8];
  const maturity  = Number(b.readBigUInt64BE(9));
  const investedAt = Number(b.readBigUInt64BE(17));
  const statusCode = b[25];
  const now       = Math.floor(Date.now() / 1000);
  return {
    principal,
    principal_algo:     principal / 1e6,
    tbill_type:         days,
    tbill_label:        `cTBILL-${days}D`,
    maturity_timestamp: maturity,
    maturity_iso:       new Date(maturity * 1000).toISOString(),
    invested_at:        investedAt,
    invested_at_iso:    new Date(investedAt * 1000).toISOString(),
    status:             statusCode === 0 ? "ACTIVE" : "REDEEMED",
    is_matured:         now >= maturity,
    seconds_until_maturity: Math.max(0, maturity - now),
  };
}

// ── Global State Reader ───────────────────────────────────────────────────────

function decodeRawState(stateArray: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const item of stateArray) {
    const key = Buffer.from(item.key, "base64").toString();
    out[key] = item.value.type === 1
      ? Buffer.from(item.value.bytes, "base64")  // bytes
      : Number(item.value.uint);                  // uint
  }
  return out;
}

function addrFromBytes(buf: Buffer): string {
  try { return algosdk.encodeAddress(buf); }
  catch { return ""; }
}

export async function getEscrowGlobalState(): Promise<EscrowGlobalState> {
  const app = await algodClient.getApplicationByID(ESCROW_APP_ID).do();
  const raw = decodeRawState(app.params["global-state"] || []);
  return {
    admin:                addrFromBytes(raw["admin"] || Buffer.alloc(32)),
    treasury_app_id:      raw["treasury_app_id"] ?? 0,
    treasury_address:     addrFromBytes(raw["treasury_address"] || Buffer.alloc(32)),
    platform_wallet:      addrFromBytes(raw["platform_wallet"] || Buffer.alloc(32)),
    total_locked:         raw["total_locked"] ?? 0,
    total_released:       raw["total_released"] ?? 0,
    total_orders:         raw["total_orders"] ?? 0,
    active_orders:        raw["active_orders"] ?? 0,
    min_order_amount:     raw["min_order_amount"] ?? 5_000_000,
    default_lock_duration: raw["default_lock_duration"] ?? 100,
    paused:               (raw["paused"] ?? 0) === 1,
  };
}

export async function getTBillGlobalState(): Promise<TBillGlobalState> {
  const app = await algodClient.getApplicationByID(TBILL_APP_ID).do();
  const raw = decodeRawState(app.params["global-state"] || []);
  return {
    admin:            addrFromBytes(raw["admin"] || Buffer.alloc(32)),
    orchestrator:     addrFromBytes(raw["orchestrator"] || Buffer.alloc(32)),
    escrow_app_id:    raw["escrow_app_id"] ?? 0,
    yield_rate_bps:   raw["yield_rate_bps"] ?? 500,
    yield_rate_pct:   (raw["yield_rate_bps"] ?? 500) / 100,
    demo_mode:        (raw["demo_mode"] ?? 1) === 1,
    demo_multiplier:  raw["demo_multiplier"] ?? 60,
    total_invested:   raw["total_invested"] ?? 0,
    total_yield_paid: raw["total_yield_paid"] ?? 0,
    active_positions: raw["active_positions"] ?? 0,
    paused:           (raw["paused"] ?? 0) === 1,
    asa_ids: {
      "1D":  raw["tbill_1d_asa"]  ?? 0,
      "3D":  raw["tbill_3d_asa"]  ?? 0,
      "7D":  raw["tbill_7d_asa"]  ?? 0,
      "14D": raw["tbill_14d_asa"] ?? 0,
      "30D": raw["tbill_30d_asa"] ?? 0,
      "60D": raw["tbill_60d_asa"] ?? 0,
      "90D": raw["tbill_90d_asa"] ?? 0,
    },
  };
}

// ── Single Order / Position ──────────────────────────────────────────────────

export async function fetchOrder(orderId: number): Promise<DecodedOrder> {
  const box = await algodClient
    .getApplicationBoxByName(ESCROW_APP_ID, orderBoxKey(orderId))
    .do();
  return decodeOrder(box.value);
}

export async function fetchPosition(orderId: number): Promise<DecodedPosition | null> {
  try {
    const box = await algodClient
      .getApplicationBoxByName(TBILL_APP_ID, positionBoxKey(orderId))
      .do();
    return decodePosition(box.value);
  } catch {
    return null;
  }
}

// ── Order List ───────────────────────────────────────────────────────────────

export async function fetchAllOrders(): Promise<{ orderId: number; order: DecodedOrder }[]> {
  const result = await algodClient.getApplicationBoxes(ESCROW_APP_ID).do();
  const orders: { orderId: number; order: DecodedOrder }[] = [];

  for (const box of result.boxes) {
    const name = Buffer.from(box.name);
    // AlgoPy BoxMap key = "orders"(6) + uint64(8) = 14 bytes
    if (name.length !== 14 || name.slice(0, 6).toString() !== "orders") continue;
    const orderId = Number(name.readBigUInt64BE(6));
    try {
      const boxData = await algodClient
        .getApplicationBoxByName(ESCROW_APP_ID, box.name)
        .do();
      orders.push({ orderId, order: decodeOrder(boxData.value) });
    } catch { /* skip malformed */ }
  }

  return orders;
}

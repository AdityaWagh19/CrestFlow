/**
 * T-Bill Service - Interacts with CadenciaTBill contract.
 * Supports 7 maturity tiers: 1D, 3D, 7D, 14D, 30D, 60D, 90D
 *
 * Box key format (AlgoPy BoxMap): attribute_name + arc4.UInt64(key)
 * For self.positions: b"positions" (9 bytes) + orderId (8 bytes big-endian)
 */
import algosdk from "algosdk";
import { TBILL_APP_ID, TBILL_APP_ADDR, orchestratorAccount } from "../config";
import * as algorand from "./algorand";
import * as logger from "../utils/logger";

export type TBillType = 1 | 3 | 7 | 14 | 30 | 60 | 90;

const POSITIONS_PREFIX = Buffer.from("positions");

const TBILL_TIERS: TBillType[] = [1, 3, 7, 14, 30, 60, 90];

function positionBoxKey(orderId: number): Uint8Array {
  const key = Buffer.alloc(POSITIONS_PREFIX.length + 8);
  POSITIONS_PREFIX.copy(key, 0);
  key.writeBigUInt64BE(BigInt(orderId), POSITIONS_PREFIX.length);
  return key;
}

function positionBox(orderId: number): { appIndex: number; name: Uint8Array } {
  return { appIndex: TBILL_APP_ID, name: positionBoxKey(orderId) };
}

/**
 * Select optimal T-bill type based on order lock duration in rounds.
 * Picks the longest tier that fits within the lock period.
 * ~3.3 seconds per round.
 */
export function selectTBillType(lockDurationRounds: number): TBillType {
  const lockDays = (lockDurationRounds * 3.3) / 86400;
  for (let i = TBILL_TIERS.length - 1; i >= 0; i--) {
    if (lockDays >= TBILL_TIERS[i]) return TBILL_TIERS[i];
  }
  return 1;
}

/**
 * Human-readable label for a T-bill type.
 */
export function tbillLabel(tbillType: TBillType): string {
  return `cTBILL-${tbillType}D`;
}

/**
 * Invest ALGO into a T-bill position.
 */
export async function invest(
  orderId: number,
  amountMicroAlgo: number,
  tbillType: TBillType
): Promise<void> {
  await algorand.callABIWithPayment(
    TBILL_APP_ID,
    "invest(pay,uint64,uint8)void",
    amountMicroAlgo,
    TBILL_APP_ADDR,
    [orderId, tbillType],
    [positionBox(orderId)]
  );
  logger.info(
    `TBill: invested ${amountMicroAlgo / 1e6} ALGO into ${tbillLabel(tbillType)} for order ${orderId}`
  );
}

/**
 * Redeem a matured T-bill position.
 * Returns total redeemed (principal + yield) in microALGO.
 */
export async function redeem(orderId: number): Promise<number> {
  const result = await algorand.callABI(
    TBILL_APP_ID,
    "redeem(uint64)uint64",
    [orderId],
    [positionBox(orderId)]
  );
  const totalRedeemed = Number(result.returnValue);
  logger.info(`TBill: redeemed order ${orderId} -> ${totalRedeemed / 1e6} ALGO`);
  return totalRedeemed;
}

/**
 * Check if a position has reached maturity (Unix timestamp based).
 */
export async function isMatured(orderId: number): Promise<boolean> {
  try {
    const result = await algorand.callABI(
      TBILL_APP_ID,
      "is_matured(uint64)bool",
      [orderId],
      [positionBox(orderId)]
    );
    return result.returnValue as boolean;
  } catch {
    return false;
  }
}

/**
 * Get the maturity Unix timestamp for a position.
 */
export async function getMaturity(orderId: number): Promise<number> {
  const result = await algorand.callABI(
    TBILL_APP_ID,
    "get_maturity(uint64)uint64",
    [orderId],
    [positionBox(orderId)]
  );
  return Number(result.returnValue);
}

/**
 * Get estimated yield for an active position (microALGO).
 */
export async function getEstimatedYield(orderId: number): Promise<number> {
  const result = await algorand.callABI(
    TBILL_APP_ID,
    "get_estimated_yield(uint64)uint64",
    [orderId],
    [positionBox(orderId)]
  );
  return Number(result.returnValue);
}

/**
 * Get aggregate T-bill platform stats.
 */
export async function getStats(): Promise<{
  totalInvested: number;
  totalYieldPaid: number;
  activePositions: number;
}> {
  const result = await algorand.callABI(
    TBILL_APP_ID,
    "get_stats()(uint64,uint64,uint64)",
    []
  );
  const val = result.returnValue as any[];
  return {
    totalInvested:   Number(val[0]),
    totalYieldPaid:  Number(val[1]),
    activePositions: Number(val[2]),
  };
}

/**
 * Compute yield locally (matches on-chain formula).
 * yield = principal * rate_bps * days / 3_650_000
 */
export function estimateYield(
  principalMicroAlgo: number,
  tbillType: TBillType,
  rateBps = 500
): number {
  return Math.floor((principalMicroAlgo * rateBps * tbillType) / 3_650_000);
}

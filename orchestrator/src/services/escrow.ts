/**
 * Escrow Service - Interacts with CadenciaEscrow contract
 *
 * Box key format (AlgoPy BoxMap): attribute_name + arc4.UInt64(key)
 * For self.orders: b"orders" (6 bytes) + orderId (8 bytes big-endian)
 */
import algosdk from "algosdk";
import { ESCROW_APP_ID, PLATFORM_WALLET, algodClient } from "../config";
import { OrderRecord, OrderStatus } from "../types";
import * as algorand from "./algorand";
import * as logger from "../utils/logger";
import { syncOrderStatus } from "./supabase";

const ORDERS_PREFIX = Buffer.from("orders");

function orderBoxKey(orderId: number): Uint8Array {
  const key = Buffer.alloc(ORDERS_PREFIX.length + 8);
  ORDERS_PREFIX.copy(key, 0);
  key.writeBigUInt64BE(BigInt(orderId), ORDERS_PREFIX.length);
  return key;
}

function orderIdBox(orderId: number): { appIndex: number; name: Uint8Array } {
  return { appIndex: ESCROW_APP_ID, name: orderBoxKey(orderId) };
}

export async function getOrder(orderId: number): Promise<OrderRecord | null> {
  try {
    const result = await algorand.callABI(
      ESCROW_APP_ID,
      "get_order(uint64)(address,address,uint64,uint64,uint64,uint8,bool,uint64)",
      [orderId],
      [orderIdBox(orderId)]
    );
    const val = result.returnValue as any[];
    return {
      buyer: val[0] as string,
      seller: val[1] as string,
      amount: Number(val[2]),
      createdAt: Number(val[3]),
      lockUntil: Number(val[4]),
      status: Number(val[5]) as OrderStatus,
      investEligible: val[6] as boolean,
      yieldEarned: Number(val[7]),
    };
  } catch (e: any) {
    if (e.message?.includes("ORDER_NOT_FOUND")) return null;
    throw e;
  }
}

export async function markInvested(orderId: number): Promise<void> {
  await algorand.callABI(
    ESCROW_APP_ID,
    "mark_invested(uint64)void",
    [orderId],
    [orderIdBox(orderId)]
  );
  logger.info(`Escrow: order ${orderId} marked INVESTED`);
  void syncOrderStatus(orderId, "INVESTED");
}

export async function markRedeemed(orderId: number, yieldEarned: number): Promise<void> {
  await algorand.callABI(
    ESCROW_APP_ID,
    "mark_redeemed(uint64,uint64)void",
    [orderId, yieldEarned],
    [orderIdBox(orderId)]
  );
  logger.info(`Escrow: order ${orderId} marked REDEEMED (yield: ${yieldEarned / 1e6} ALGO)`);
  void syncOrderStatus(orderId, "REDEEMED", yieldEarned);
}

export async function transferToTreasury(orderId: number): Promise<void> {
  await algorand.callABI(
    ESCROW_APP_ID,
    "transfer_to_treasury(uint64)void",
    [orderId],
    [orderIdBox(orderId)]
  );
  logger.info(`Escrow: ALGO transferred to orchestrator for order ${orderId}`);
}

export async function receiveFromTreasury(orderId: number, amount: number): Promise<void> {
  await algorand.callABIWithPayment(
    ESCROW_APP_ID,
    "receive_from_treasury(pay,uint64)void",
    amount,
    algosdk.getApplicationAddress(ESCROW_APP_ID).toString(),
    [orderId],
    [orderIdBox(orderId)]
  );
  logger.info(`Escrow: received ${amount / 1e6} ALGO back for order ${orderId}`);
}

export async function completeOrder(orderId: number, sellerAddr: string): Promise<void> {
  // fee=4000: outer (1000) + 2 inner payments to seller + platform (2×1000)
  // accounts: seller and platform wallet must be referenced as foreign accounts
  await algorand.callABI(
    ESCROW_APP_ID,
    "complete_order(uint64)void",
    [orderId],
    [orderIdBox(orderId)],
    4000,
    [sellerAddr, PLATFORM_WALLET]
  );
  logger.info(`Escrow: order ${orderId} COMPLETED — seller paid, yield distributed`);
  void syncOrderStatus(orderId, "COMPLETED");
}

export async function getEscrowStats(): Promise<{
  totalLocked: number;
  totalReleased: number;
  totalOrders: number;
  activeOrders: number;
}> {
  const result = await algorand.callABI(
    ESCROW_APP_ID,
    "get_escrow_stats()(uint64,uint64,uint64,uint64)",
    []
  );
  const val = result.returnValue as any[];
  return {
    totalLocked:   Number(val[0]),
    totalReleased: Number(val[1]),
    totalOrders:   Number(val[2]),
    activeOrders:  Number(val[3]),
  };
}

/**
 * Enumerate all order boxes via the Algod API, decode order IDs from
 * the box names (prefix "orders" + 8-byte big-endian uint64), then
 * fetch and filter by status.
 */
export async function findOrdersByStatus(
  targetStatus: OrderStatus
): Promise<{ orderId: number; order: OrderRecord }[]> {
  const results: { orderId: number; order: OrderRecord }[] = [];

  try {
    const resp = await algodClient.getApplicationBoxes(ESCROW_APP_ID).do();
    const boxes: any[] = (resp as any).boxes ?? [];

    for (const box of boxes) {
      // box.name is Uint8Array: "orders" (6 bytes) + uint64 (8 bytes)
      const name: Uint8Array = box.name;
      if (name.length !== ORDERS_PREFIX.length + 8) continue;

      // Verify prefix
      const prefix = name.slice(0, ORDERS_PREFIX.length);
      if (!ORDERS_PREFIX.equals(Buffer.from(prefix))) continue;

      // Decode order_id from last 8 bytes
      const idBytes = name.slice(ORDERS_PREFIX.length);
      const orderId = Number(
        new DataView(idBytes.buffer, idBytes.byteOffset, 8).getBigUint64(0)
      );

      try {
        const order = await getOrder(orderId);
        if (order && order.status === targetStatus) {
          results.push({ orderId, order });
        }
      } catch {
        // skip unreadable orders
      }
    }
  } catch (e: any) {
    logger.error(`findOrdersByStatus scan failed: ${e.message}`);
  }

  return results;
}

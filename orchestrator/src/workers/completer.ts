/**
 * Completer Worker - Auto-completes REDEEMED orders.
 * Called after the redeemer worker has returned funds to Escrow.
 * Pays principal to seller and yield to platform wallet via inner txns.
 */
import { OrderStatus } from "../types";
import * as escrow from "../services/escrow";
import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";

export async function autoCompleteRedeemedOrders(): Promise<void> {
  const redeemedOrders = await escrow.findOrdersByStatus(OrderStatus.REDEEMED);

  if (redeemedOrders.length === 0) return;

  logger.info(`Found ${redeemedOrders.length} REDEEMED order(s) to auto-complete`);

  for (const { orderId, order } of redeemedOrders) {
    await withRetry(
      () => escrow.completeOrder(orderId, order.seller),
      `complete(${orderId})`
    ).then((result) => {
      if (result !== null)
        logger.info(
          `Auto-completed order ${orderId}: ` +
          `${order.amount / 1e6} ALGO -> seller, ` +
          `${order.yieldEarned / 1e6} ALGO -> platform`
        );
    });
  }
}

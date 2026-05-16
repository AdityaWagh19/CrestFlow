/**
 * Distributor Worker - Monitors REDEEMED orders and logs platform stats.
 */
import { OrderStatus } from "../types";
import * as escrow from "../services/escrow";
import * as tbill from "../services/tbill";
import * as logger from "../utils/logger";

export async function checkRedeemedOrders(): Promise<void> {
  const redeemedOrders = await escrow.findOrdersByStatus(OrderStatus.REDEEMED);

  if (redeemedOrders.length === 0) return;

  logger.info(`${redeemedOrders.length} REDEEMED order(s) awaiting admin action (complete/cancel)`);

  for (const { orderId, order } of redeemedOrders) {
    logger.info(
      `  Order ${orderId}: ${order.amount / 1e6} ALGO principal, ` +
      `${order.yieldEarned / 1e6} ALGO yield`
    );
  }
}

export async function logStats(): Promise<void> {
  try {
    const escrowStats = await escrow.getEscrowStats();
    const tbillStats = await tbill.getStats();

    logger.info("--- Platform Stats ---");
    logger.info(`  Escrow:  locked=${escrowStats.totalLocked / 1e6} ALGO, active=${escrowStats.activeOrders} orders`);
    logger.info(`  T-Bills: invested=${tbillStats.totalInvested / 1e6} ALGO, yield_paid=${tbillStats.totalYieldPaid / 1e6} ALGO, active=${tbillStats.activePositions}`);
  } catch (err: any) {
    logger.error(`Failed to fetch stats: ${err.message}`);
  }
}

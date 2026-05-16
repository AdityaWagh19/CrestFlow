/**
 * Redeemer Worker - Detects matured T-bill positions and auto-redeems.
 * Uses Unix timestamp maturity (not round-based).
 */
import { OrderStatus } from "../types";
import * as escrow from "../services/escrow";
import * as tbill from "../services/tbill";
import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getYieldBackend } from "../services/yield-backend";

export async function redeemExpiredOrders(): Promise<void> {
  const investedOrders = await escrow.findOrdersByStatus(OrderStatus.INVESTED);

  if (investedOrders.length === 0) return;

  for (const { orderId, order } of investedOrders) {
    // Maturity check is cheap — no retry needed
    const matured = await tbill.isMatured(orderId).catch(() => false);
    if (!matured) {
      const maturityTs = await tbill.getMaturity(orderId).catch(() => 0);
      const remaining  = maturityTs - Math.floor(Date.now() / 1000);
      if (remaining > 0)
        logger.info(`Order ${orderId}: matures in ${remaining}s (${Math.ceil(remaining / 60)}min)`);
      continue;
    }

    logger.info(`Order ${orderId} matured! Redeeming T-bill position...`);

    await withRetry(async () => {
      // Yield backend hook — withdraws from DeFi back to contract on mainnet Phase 2
      const yb = getYieldBackend();
      if (yb.name() !== "on-chain-reserve") {
        await yb.withdraw(orderId); // pulls DeFi funds back into TBill contract
      }

      const totalRedeemed = await tbill.redeem(orderId);
      const yieldEarned   = totalRedeemed > order.amount ? totalRedeemed - order.amount : 0;
      await escrow.receiveFromTreasury(orderId, totalRedeemed);
      await escrow.markRedeemed(orderId, yieldEarned);
      logger.info(
        `Redeemed order ${orderId}: principal=${order.amount / 1e6}, yield=${yieldEarned / 1e6} ALGO [backend=${yb.name()}]`
      );
    }, `redeem(${orderId})`);
  }
}

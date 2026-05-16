/**
 * Investor Worker - Detects PENDING eligible orders and invests into T-bills.
 */
import { OrderStatus } from "../types";
import * as escrow from "../services/escrow";
import * as tbill from "../services/tbill";
import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getYieldBackend } from "../services/yield-backend";

export async function investPendingOrders(): Promise<void> {
  const pendingOrders = await escrow.findOrdersByStatus(OrderStatus.PENDING);
  const eligible = pendingOrders.filter((o) => o.order.investEligible);

  if (eligible.length === 0) return;

  logger.info(`Found ${eligible.length} eligible PENDING order(s) to invest`);

  for (const { orderId, order } of eligible) {
    await withRetry(async () => {
      const lockDurationRounds = order.lockUntil - order.createdAt;
      const tbillType = tbill.selectTBillType(lockDurationRounds);
      await escrow.transferToTreasury(orderId);
      await tbill.invest(orderId, order.amount, tbillType);

      // Yield backend hook — routes to DeFi on mainnet Phase 2, no-op for reserve
      const yb = getYieldBackend();
      if (yb.name() !== "on-chain-reserve") {
        await yb.deposit(orderId, order.amount, tbillType);
      }

      await escrow.markInvested(orderId);
      logger.info(
        `Invested order ${orderId}: ${order.amount / 1e6} ALGO -> ${tbill.tbillLabel(tbillType)} [backend=${yb.name()}]`
      );
    }, `invest(${orderId})`);
  }
}

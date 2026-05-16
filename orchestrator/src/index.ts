/**
 * Cadencia Treasury Orchestrator - Main Entry Point
 * Polls for order state changes and manages the T-bill investment lifecycle.
 */
import {
  ESCROW_APP_ID, TBILL_APP_ID,
  TBILL_1D_ASA, TBILL_3D_ASA, TBILL_7D_ASA, TBILL_14D_ASA,
  TBILL_30D_ASA, TBILL_60D_ASA, TBILL_90D_ASA,
  POLL_INTERVAL_MS, orchestratorAccount,
} from "./config";
import * as algorand from "./services/algorand";
import { investPendingOrders } from "./workers/investor";
import { redeemExpiredOrders } from "./workers/redeemer";
import { autoCompleteRedeemedOrders } from "./workers/completer";
import { logStats } from "./workers/distributor";
import * as logger from "./utils/logger";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycle(cycleCount: number): Promise<void> {
  await investPendingOrders();          // PENDING  → INVESTED
  await redeemExpiredOrders();          // INVESTED → REDEEMED (on maturity)
  await autoCompleteRedeemedOrders();   // REDEEMED → COMPLETED (auto-pay seller)

  if (cycleCount % 5 === 0) {
    await logStats();
  }
}

async function main(): Promise<void> {
  logger.info("========================================");
  logger.info("  Cadencia Treasury Orchestrator v2");
  logger.info("  T-Bill Mode");
  logger.info("========================================");

  const round = await algorand.getCurrentRound();
  const balance = await algorand.getAccountBalance(orchestratorAccount.addr.toString());

  logger.info(`Network:      Algorand Testnet (round ${round})`);
  logger.info(`Orchestrator: ${orchestratorAccount.addr.toString()}`);
  logger.info(`Balance:      ${balance / 1e6} ALGO`);
  logger.info(`Poll:         ${POLL_INTERVAL_MS / 1000}s`);
  logger.info(`Escrow App:   ${ESCROW_APP_ID}`);
  logger.info(`TBill App:    ${TBILL_APP_ID}`);
  logger.info(`ASAs:         1D=${TBILL_1D_ASA} | 3D=${TBILL_3D_ASA} | 7D=${TBILL_7D_ASA} | 14D=${TBILL_14D_ASA}`);
  logger.info(`              30D=${TBILL_30D_ASA} | 60D=${TBILL_60D_ASA} | 90D=${TBILL_90D_ASA}`);
  logger.info("----------------------------------------");
  logger.info("Starting orchestrator loop...");

  let cycleCount = 0;

  while (true) {
    cycleCount++;
    try {
      await runCycle(cycleCount);
    } catch (err: any) {
      logger.error(`Cycle ${cycleCount} error: ${err.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

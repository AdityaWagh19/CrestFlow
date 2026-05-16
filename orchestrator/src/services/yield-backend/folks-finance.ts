/**
 * FolksFinanceYieldBackend — Mainnet Phase 2 Stub
 *
 * Will deposit idle ALGO from the TBill contract into Folks Finance v2
 * ALGO lending pool to earn real DeFi yield (~3-5% APY).
 *
 * NOT YET IMPLEMENTED. isSupported() returns false to prevent accidental activation.
 * Flip isSupported() to true only after the full SDK integration is complete.
 */
import { YieldBackend } from "./interface";
import * as logger from "../../utils/logger";

export class FolksFinanceYieldBackend implements YieldBackend {
  async deposit(orderId: number, amount: number, tbillType: number): Promise<void> {
    // TODO (Mainnet Phase 2):
    // 1. import { FolksFinance } from "@folks-finance/algo-defi-sdk"
    // 2. const ff = new FolksFinance({ algodClient, indexerClient, network: "mainnet" })
    // 3. await ff.deposit(FOLKS_ALGO_POOL_APP_ID, amount, orchestratorAccount)
    // 4. Store deposit receipt / fAlgo balance keyed by orderId for later withdrawal
    logger.warn(`FolksFinance.deposit() called but not yet implemented (order ${orderId}, amount ${amount}, tier ${tbillType}D)`);
    throw new Error("FolksFinance yield backend not yet implemented — set YIELD_BACKEND=reserve");
  }

  async withdraw(orderId: number): Promise<{ principal: number; yield: number }> {
    // TODO (Mainnet Phase 2):
    // 1. Retrieve fAlgo balance for this orderId
    // 2. await ff.withdraw(FOLKS_ALGO_POOL_APP_ID, fAlgoBalance, orchestratorAccount)
    // 3. Return { principal, yield } so the completer can route yield to PLATFORM_WALLET
    logger.warn(`FolksFinance.withdraw() called but not yet implemented (order ${orderId})`);
    throw new Error("FolksFinance yield backend not yet implemented — set YIELD_BACKEND=reserve");
  }

  isSupported(): boolean {
    return false; // flip to true once the full SDK integration is complete
  }

  name(): string { return "folks-finance-v2"; }
}

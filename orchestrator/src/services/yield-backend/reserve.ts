/**
 * ReserveYieldBackend — Default (Testnet + Mainnet Phase 1)
 *
 * The TBill smart contract holds a pre-funded ALGO reserve.
 * tbill.invest() and tbill.redeem() handle everything on-chain.
 * No external DeFi calls needed — deposit/withdraw are intentional no-ops.
 */
import { YieldBackend } from "./interface";

export class ReserveYieldBackend implements YieldBackend {
  async deposit(
    _orderId: number,
    _amountMicroAlgo: number,
    _tbillType: number
  ): Promise<void> {
    // no-op: funds are already in the TBill contract reserve
  }

  async withdraw(_orderId: number): Promise<{ principal: number; yield: number }> {
    // no-op: tbill.redeem() on-chain handles the withdrawal
    return { principal: 0, yield: 0 };
  }

  isSupported(): boolean { return true; }
  name(): string { return "on-chain-reserve"; }
}

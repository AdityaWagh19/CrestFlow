/**
 * YieldBackend Interface
 *
 * Defines the contract for how the platform moves idle escrow funds
 * to earn yield. The buyer never sees this — it is an internal operation.
 */
export interface YieldBackend {
  /**
   * Move funds from the TBill contract into the yield-generating source.
   * Called after tbill.invest() succeeds on-chain.
   */
  deposit(orderId: number, amountMicroAlgo: number, tbillType: number): Promise<void>;

  /**
   * Withdraw principal + yield back from the source into the TBill contract.
   * Called before tbill.redeem() so funds are available for settlement.
   */
  withdraw(orderId: number): Promise<{ principal: number; yield: number }>;

  /** Returns true when this backend is fully implemented and safe to activate. */
  isSupported(): boolean;

  /** Unique identifier used for routing logic in workers. */
  name(): string;
}

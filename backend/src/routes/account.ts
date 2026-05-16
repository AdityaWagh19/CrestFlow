/**
 * Account Routes
 *
 * GET /account/:address         — ALGO balance, min balance, asset holdings
 * GET /account/:address/orders  — all orders where address is buyer OR seller
 */
import { Router, Request, Response } from "express";
import algosdk from "algosdk";
import { algodClient, EXPLORER_BASE } from "../config";
import { fetchAllOrders } from "../services/chain";

const ALGO_BLOCK_TIME_SEC = 3.3;
function roundToTs(orderRound: number, currentRound: number, nowSec: number): string {
  return new Date(((nowSec) - (currentRound - orderRound) * ALGO_BLOCK_TIME_SEC) * 1000).toISOString();
}

export const accountRouter = Router();

// ─── GET /account/:address ──────────────────────────────────────────────────

accountRouter.get("/:address", async (req: Request, res: Response) => {
  const { address } = req.params;

  try { algosdk.decodeAddress(address); } catch {
    res.status(400).json({ error: "Invalid Algorand address" });
    return;
  }

  try {
    const info = await algodClient.accountInformation(address).do();

    const assets = (info.assets || []).map((a: any) => ({
      asa_id:  Number(a["asset-id"]),
      amount:  Number(a.amount),
      frozen:  a["is-frozen"] ?? false,
    }));

    const amount   = Number(info.amount);
    const minBal   = Number(info["min-balance"]);
    const spendable = Math.max(0, amount - minBal);

    res.json({
      address,
      balance_microalgo:   amount,
      balance_algo:        amount / 1e6,
      min_balance_microalgo: minBal,
      min_balance_algo:    minBal / 1e6,
      spendable_algo:      spendable / 1e6,
      opted_in_apps:       (info["apps-local-state"] || []).length,
      opted_in_assets:     assets.length,
      assets,
      status:              info.status,
      explorer: `${EXPLORER_BASE}/address/${address}`,
    });
  } catch (err: any) {
    if (err.message?.includes("404") || err.message?.includes("no accounts")) {
      res.json({
        address,
        balance_microalgo: 0,
        balance_algo:      0,
        min_balance_microalgo: 0,
        min_balance_algo:  0,
        spendable_algo:    0,
        opted_in_assets:   0,
        assets:            [],
        status:            "offline",
        note:              "Account not yet funded",
      });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ─── GET /account/:address/orders ───────────────────────────────────────────

accountRouter.get("/:address/orders", async (req: Request, res: Response) => {
  const { address } = req.params;
  const role = (req.query.role as string | undefined) ?? "any"; // "buyer" | "seller" | "any"
  const statusFilter = req.query.status as string | undefined;

  try { algosdk.decodeAddress(address); } catch {
    res.status(400).json({ error: "Invalid Algorand address" });
    return;
  }

  try {
    const allOrders = await fetchAllOrders();

    const sp = await algodClient.getTransactionParams().do();
    const currentRound = Number((sp as any).firstRound);
    const nowSec = Math.floor(Date.now() / 1000);

    const matched = allOrders.filter(({ order }) => {
      const isBuyer  = order.buyer  === address;
      const isSeller = order.seller === address;

      if (role === "buyer"  && !isBuyer)  return false;
      if (role === "seller" && !isSeller) return false;
      if (role === "any"    && !isBuyer && !isSeller) return false;

      if (statusFilter && order.status !== statusFilter.toUpperCase()) return false;
      return true;
    });

    // Sort: most recent first
    matched.sort((a, b) => b.order.created_at - a.order.created_at);

    // Compute summary stats
    const totalPaidAlgo = matched
      .filter((o) => o.order.status === "COMPLETED")
      .reduce((s, o) => s + o.order.amount_algo, 0);

    res.json({
      address,
      role,
      total_orders: matched.length,
      summary: {
        total_transacted_algo: parseFloat(totalPaidAlgo.toFixed(6)),
        by_status: ["PENDING","INVESTED","REDEEMED","COMPLETED","CANCELLED"].reduce(
          (acc, s) => ({ ...acc, [s]: matched.filter((o) => o.order.status === s).length }),
          {} as Record<string, number>
        ),
      },
      // Strip all financial/investment fields from the public order list
      orders: matched.map(({ orderId, order }) => ({
        order_id:    orderId,
        status:      order.status,
        buyer:       order.buyer,
        seller:      order.seller,
        amount_algo: order.amount_algo,
        lock_until:  roundToTs(order.lock_until, currentRound, nowSec),
        created_at:  roundToTs(order.created_at, currentRound, nowSec),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

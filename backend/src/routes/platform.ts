/**
 * Platform Routes
 *
 * GET  /platform/status  — public: operational status only (no yield data)
 * GET  /platform/stats   — INTERNAL admin only (requires Supabase session JWT)
 * GET  /platform/config  — INTERNAL admin only (requires Supabase session JWT)
 * GET  /platform/tiers   — public: lock durations framed as operational info (no yield/APY)
 */
import { Router, Request, Response } from "express";
import { getEscrowGlobalState, getTBillGlobalState } from "../services/chain";
import {
  algodClient, ESCROW_APP_ID, TBILL_APP_ID, PLATFORM_WALLET,
  VALID_TIERS, NETWORK, EXPLORER_BASE,
} from "../config";
import { requireAdminAuth } from "../middleware/adminAuth";

export const platformRouter = Router();

// ─── GET /platform/status (PUBLIC) ──────────────────────────────────────────
// Operational health info only — no yield data exposed

platformRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const escrow = await getEscrowGlobalState();
    res.json({
      network:        NETWORK,
      escrow_active:  !escrow.paused,
      total_orders:   escrow.total_orders,
      active_orders:  escrow.active_orders,
      min_order_algo: escrow.min_order_amount / 1e6,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /platform/stats (ADMIN ONLY) ───────────────────────────────────────
// Internal analytics — full yield and T-bill investment data

platformRouter.get("/stats",  requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const [escrow, tbill] = await Promise.all([
      getEscrowGlobalState(),
      getTBillGlobalState(),
    ]);

    res.json({
      escrow: {
        total_locked_microalgo:   escrow.total_locked,
        total_locked_algo:        escrow.total_locked / 1e6,
        total_released_microalgo: escrow.total_released,
        total_released_algo:      escrow.total_released / 1e6,
        total_orders:             escrow.total_orders,
        active_orders:            escrow.active_orders,
        min_order_algo:           escrow.min_order_amount / 1e6,
        paused:                   escrow.paused,
      },
      tbill: {
        total_invested_microalgo:   tbill.total_invested,
        total_invested_algo:        tbill.total_invested / 1e6,
        total_yield_paid_microalgo: tbill.total_yield_paid,
        total_yield_paid_algo:      tbill.total_yield_paid / 1e6,
        active_positions:           tbill.active_positions,
        yield_rate_bps:             tbill.yield_rate_bps,
        yield_rate_pct:             tbill.yield_rate_pct,
        demo_mode:                  tbill.demo_mode,
        demo_multiplier_sec:        tbill.demo_multiplier,
        paused:                     tbill.paused,
      },
      platform: {
        platform_wallet:         PLATFORM_WALLET,
        total_yield_earned_algo: tbill.total_yield_paid / 1e6,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /platform/config (ADMIN ONLY) ──────────────────────────────────────
// Internal contract addresses and infrastructure details

platformRouter.get("/config", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const [escrow, tbill, sp] = await Promise.all([
      getEscrowGlobalState(),
      getTBillGlobalState(),
      algodClient.getTransactionParams().do(),
    ]);

    const escrowAddr = require("algosdk").getApplicationAddress(ESCROW_APP_ID).toString();
    const tbillAddr  = require("algosdk").getApplicationAddress(TBILL_APP_ID).toString();

    res.json({
      network: NETWORK,
      round:   Number((sp as any).firstRound),
      contracts: {
        escrow: {
          app_id:    ESCROW_APP_ID,
          address:   escrowAddr,
          admin:     escrow.admin,
          paused:    escrow.paused,
          explorer:  `${EXPLORER_BASE}/application/${ESCROW_APP_ID}`,
        },
        tbill: {
          app_id:       TBILL_APP_ID,
          address:      tbillAddr,
          admin:        tbill.admin,
          orchestrator: tbill.orchestrator,
          demo_mode:    tbill.demo_mode,
          paused:       tbill.paused,
          explorer:     `${EXPLORER_BASE}/application/${TBILL_APP_ID}`,
        },
      },
      platform_wallet:   PLATFORM_WALLET,
      min_order_algo:    escrow.min_order_amount / 1e6,
      valid_lock_days:   VALID_TIERS,
      asa_ids:           tbill.asa_ids,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /platform/tiers (PUBLIC) ───────────────────────────────────────────
// Lock durations framed as operational lock periods — no yield or APY exposed

platformRouter.get("/tiers", async (_req: Request, res: Response) => {
  try {
    const tbill = await getTBillGlobalState();

    const tiers = VALID_TIERS.map((days) => ({
      days,
      lock_label:             `${days}-Day Secure Lock`,
      estimated_release_days: days,
      demo_maturity_seconds:  days * tbill.demo_multiplier,
      demo_maturity_label:    days * tbill.demo_multiplier < 3600
        ? `${days * tbill.demo_multiplier}s (~${Math.round(days * tbill.demo_multiplier / 60)}min)`
        : `${Math.round(days * tbill.demo_multiplier / 60)}min`,
    }));

    res.json({
      demo_mode: tbill.demo_mode,
      tiers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

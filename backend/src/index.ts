/**
 * Cadencia Treasury - Backend API
 *
 * Base URL: http://localhost:3001
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 *  POST /auth/nonce          issue nonce for wallet address
 *  POST /auth/verify         verify Ed25519 signature → JWT
 *
 * ── Orders ───────────────────────────────────────────────────────────────────
 *  GET  /orders              list all orders (filters: status, buyer, seller, limit, offset)
 *  GET  /orders/estimate     preview yield/maturity for given params (no auth)
 *  GET  /orders/:id          single order + T-bill position + lifecycle info
 *  POST /orders/prepare      [JWT] build unsigned grouped txns for buyer to sign
 *  POST /orders/submit       [JWT] submit buyer-signed txns to Algorand
 *  DELETE /orders/:id        [JWT] cancel order (admin-signed)
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *  GET  /platform/stats      live on-chain stats (escrow + tbill)
 *  GET  /platform/config     contract IDs, addresses, ASA IDs, network info
 *  GET  /platform/tiers      all 7 T-bill tiers with APY and demo maturity
 *
 * ── Account ──────────────────────────────────────────────────────────────────
 *  GET  /account/:address           wallet balance and asset holdings
 *  GET  /account/:address/orders    orders for address (?role=buyer|seller|any)
 *
 * ── Transactions ─────────────────────────────────────────────────────────────
 *  GET  /tx/:txid            transaction confirmation status + details
 *
 * ── Health ───────────────────────────────────────────────────────────────────
 *  GET  /health              server + network health check
 */
import express    from "express";
import cors       from "cors";
import algosdk    from "algosdk";
import { authRouter     } from "./routes/auth";
import { ordersRouter   } from "./routes/orders";
import { platformRouter } from "./routes/platform";
import { accountRouter  } from "./routes/account";
import { algodClient, ESCROW_APP_ID, TBILL_APP_ID, PORT, EXPLORER_BASE } from "./config";

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",   // Vite dev server
  "http://localhost:4173",   // Vite preview
  process.env.FRONTEND_URL ?? "",
].filter(Boolean);

// In dev, Vite port increments if 8080 is busy — allow any localhost port.
const isLocalhostOrigin = (origin: string) =>
  /^http:\/\/localhost:\d+$/.test(origin) ||
  /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (isLocalhostOrigin(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    const sp = await algodClient.getTransactionParams().do();
    res.json({
      status:       "ok",
      network:      "algorand-testnet",
      round:        Number((sp as any).firstRound),
      escrow_app:   ESCROW_APP_ID,
      tbill_app:    TBILL_APP_ID,
      timestamp:    new Date().toISOString(),
      endpoints: {
        auth:        ["/auth/nonce", "/auth/verify"],
        orders:      ["/orders", "/orders/estimate", "/orders/:id", "/orders/prepare", "/orders/submit"],
        platform:    ["/platform/stats", "/platform/config", "/platform/tiers"],
        account:     ["/account/:address", "/account/:address/orders"],
        transaction: ["/tx/:txid"],
      },
    });
  } catch (err: any) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

// ── Transaction Status ───────────────────────────────────────────────────────
app.get("/tx/:txid", async (req, res) => {
  try {
    const info = await algodClient.pendingTransactionInformation(req.params.txid).do();
    const confirmed = info.confirmedRound && Number(info.confirmedRound) > 0;
    res.json({
      txid:            req.params.txid,
      confirmed:       confirmed,
      confirmed_round: confirmed ? Number(info.confirmedRound) : null,
      pool_error:      info.poolError || null,
      explorer: `${EXPLORER_BASE}/tx/${req.params.txid}`,
    });
  } catch {
    // Transaction not in pool/not found — may be too old, check indexer
    res.status(404).json({
      txid:    req.params.txid,
      error:   "Transaction not found in pending pool. It may be confirmed or not submitted.",
      explorer: `${EXPLORER_BASE}/tx/${req.params.txid}`,
    });
  }
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/auth",     authRouter);
app.use("/orders",   ordersRouter);
app.use("/platform", platformRouter);
app.use("/account",  accountRouter);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error:     "Not found",
    path:      req.path,
    available: ["/health", "/auth/*", "/orders/*", "/platform/*", "/account/*", "/tx/*"],
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ┌─ Cadencia Treasury Backend ─────────────────────────────┐`);
  console.log(`  │  http://localhost:${PORT}/health                           │`);
  console.log(`  │  Escrow App : ${ESCROW_APP_ID}                           │`);
  console.log(`  │  TBill App  : ${TBILL_APP_ID}                           │`);
  console.log(`  └──────────────────────────────────────────────────────────┘\n`);
});

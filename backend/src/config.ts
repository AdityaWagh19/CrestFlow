import * as dotenv from "dotenv";
import * as path from "path";
import algosdk from "algosdk";

// Load .env from project root (two levels up from backend/src)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}
function opt(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const PORT            = parseInt(opt("BACKEND_PORT", "3001"));
export const JWT_SECRET      = opt("JWT_SECRET", "cadencia-dev-secret-change-in-prod");
export const JWT_EXPIRY_SEC  = 86400; // 24h
export const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 min

// Network Config
export const NETWORK    = opt("NETWORK", "testnet").toLowerCase();
export const IS_MAINNET = NETWORK === "mainnet";

const DEFAULT_ALGOD_SERVER = IS_MAINNET 
  ? "https://mainnet-api.algonode.cloud" 
  : "https://testnet-api.algonode.cloud";

const DEFAULT_EXPLORER = IS_MAINNET
  ? "https://explorer.perawallet.app"
  : "https://testnet.explorer.perawallet.app";

export const EXPLORER_BASE = opt("EXPLORER_BASE", DEFAULT_EXPLORER);


export const ESCROW_APP_ID   = parseInt(req("ESCROW_APP_ID"));
export const TBILL_APP_ID    = parseInt(req("TBILL_APP_ID"));
export const PLATFORM_WALLET = req("PLATFORM_WALLET_ADDRESS");

export const algodClient = new algosdk.Algodv2(
  opt("ALGOD_TOKEN", ""),
  opt("ALGOD_SERVER", DEFAULT_ALGOD_SERVER),
  opt("ALGOD_PORT",   "443")
);

// T-Bill tier → lock rounds mapping (production; demo uses Unix timestamp)
export const TIER_ROUNDS: Record<number, number> = {
  1:  500,
  3:  100_000,
  7:  250_000,
  14: 500_000,
  30: 1_000_000,
  60: 2_000_000,
  90: 3_000_000,
};

export const VALID_TIERS = [1, 3, 7, 14, 30, 60, 90];

import * as dotenv from "dotenv";
import * as path from "path";
import algosdk from "algosdk";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

// Network Config
export const NETWORK    = optionalEnv("NETWORK", "testnet").toLowerCase();
export const IS_MAINNET = NETWORK === "mainnet";

const DEFAULT_ALGOD = IS_MAINNET
  ? "https://mainnet-api.algonode.cloud"
  : "https://testnet-api.algonode.cloud";

const DEFAULT_INDEXER = IS_MAINNET
  ? "https://mainnet-idx.algonode.cloud"
  : "https://testnet-idx.algonode.cloud";

const DEFAULT_EXPLORER = IS_MAINNET
  ? "https://explorer.perawallet.app"
  : "https://testnet.explorer.perawallet.app";

export const EXPLORER_BASE = optionalEnv("EXPLORER_BASE", DEFAULT_EXPLORER);
export const YIELD_BACKEND = optionalEnv("YIELD_BACKEND", "reserve");


// Algorand clients
export const algodClient = new algosdk.Algodv2(
  optionalEnv("ALGOD_TOKEN", ""),
  optionalEnv("ALGOD_SERVER", DEFAULT_ALGOD),
  optionalEnv("ALGOD_PORT", "443")
);

export const indexerClient = new algosdk.Indexer(
  "",
  optionalEnv("INDEXER_SERVER", DEFAULT_INDEXER),
  optionalEnv("INDEXER_PORT", "443")
);

// Accounts
const orchestratorMnemonic = requireEnv("ORCHESTRATOR_MNEMONIC");
export const orchestratorAccount = algosdk.mnemonicToSecretKey(orchestratorMnemonic);

// App IDs
export const ESCROW_APP_ID = parseInt(requireEnv("ESCROW_APP_ID"));
export const TBILL_APP_ID  = parseInt(requireEnv("TBILL_APP_ID"));

// App Addresses
export const ESCROW_APP_ADDR = algosdk.getApplicationAddress(ESCROW_APP_ID).toString();
export const TBILL_APP_ADDR  = algosdk.getApplicationAddress(TBILL_APP_ID).toString();

// T-Bill ASA IDs — all 7 maturity tiers
export const TBILL_1D_ASA  = parseInt(optionalEnv("TBILL_1D_ASA",  "0"));
export const TBILL_3D_ASA  = parseInt(optionalEnv("TBILL_3D_ASA",  "0"));
export const TBILL_7D_ASA  = parseInt(optionalEnv("TBILL_7D_ASA",  "0"));
export const TBILL_14D_ASA = parseInt(optionalEnv("TBILL_14D_ASA", "0"));
export const TBILL_30D_ASA = parseInt(optionalEnv("TBILL_30D_ASA", "0"));
export const TBILL_60D_ASA = parseInt(optionalEnv("TBILL_60D_ASA", "0"));
export const TBILL_90D_ASA = parseInt(optionalEnv("TBILL_90D_ASA", "0"));

// Config
export const POLL_INTERVAL_MS  = parseInt(optionalEnv("POLL_INTERVAL_MS", "30000"));
export const MIN_ORDER_AMOUNT  = parseInt(optionalEnv("MIN_ORDER_AMOUNT_MICROALGO", "5000000"));
export const PLATFORM_WALLET   = requireEnv("PLATFORM_WALLET_ADDRESS");


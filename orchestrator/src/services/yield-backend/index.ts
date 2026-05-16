/**
 * YieldBackend Factory
 *
 * Returns a singleton YieldBackend instance based on the YIELD_BACKEND env var.
 *   YIELD_BACKEND=reserve        → ReserveYieldBackend (default, current behaviour)
 *   YIELD_BACKEND=folks-finance  → FolksFinanceYieldBackend (mainnet Phase 2)
 */
import { YieldBackend } from "./interface";
import { ReserveYieldBackend } from "./reserve";
import { FolksFinanceYieldBackend } from "./folks-finance";
import { YIELD_BACKEND } from "../../config";

let _instance: YieldBackend | null = null;

export function getYieldBackend(): YieldBackend {
  if (_instance) return _instance;
  switch (YIELD_BACKEND) {
    case "folks-finance":
      _instance = new FolksFinanceYieldBackend();
      break;
    default:
      _instance = new ReserveYieldBackend();
  }
  return _instance;
}

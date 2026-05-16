/**
 * Nonce Service
 * Generates and validates short-lived nonces for wallet auth.
 * In-memory store (fine for demo; swap for Redis in production).
 */
import * as crypto from "crypto";
import { NONCE_EXPIRY_MS } from "../config";

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

const store = new Map<string, NonceEntry>(); // address → nonce

// Purge expired nonces every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [addr, entry] of store) {
    if (entry.expiresAt < now) store.delete(addr);
  }
}, NONCE_EXPIRY_MS);

export function generateNonce(address: string): { nonce: string; expiresAt: number } {
  const nonce = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + NONCE_EXPIRY_MS;
  store.set(address, { nonce, expiresAt });
  return { nonce, expiresAt };
}

export function consumeNonce(address: string, nonce: string): boolean {
  const entry = store.get(address);
  if (!entry) return false;
  if (entry.nonce !== nonce) return false;
  if (entry.expiresAt < Date.now()) { store.delete(address); return false; }
  store.delete(address); // one-time use
  return true;
}

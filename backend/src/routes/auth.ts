/**
 * Auth Routes
 *
 * POST /auth/nonce   — issue a nonce for an Algorand address
 * POST /auth/verify  — verify Ed25519 signature of nonce, return JWT
 *
 * Non-custodial: we never handle private keys.
 * Signing uses algosdk.signBytes (prepends "MX" prefix to prevent tx replay).
 *
 * Client-side signing (e.g. Pera Wallet):
 *   const sig = await peraWallet.signData([{data: Buffer.from(nonce,'hex'), message:"Login"}], addr);
 *
 * For testing (script):
 *   const sig = algosdk.signBytes(Buffer.from(nonce,'hex'), secretKey);
 */
import { Router, Request, Response } from "express";
import algosdk from "algosdk";
import jwt from "jsonwebtoken";
import { generateNonce, consumeNonce } from "../services/nonce";
import { JWT_SECRET, JWT_EXPIRY_SEC } from "../config";

export const authRouter = Router();

// POST /auth/nonce
authRouter.post("/nonce", (req: Request, res: Response) => {
  const { address } = req.body as { address?: string };

  if (!address) {
    res.status(400).json({ error: "address required" });
    return;
  }
  try {
    algosdk.decodeAddress(address); // validates checksum
  } catch {
    res.status(400).json({ error: "Invalid Algorand address" });
    return;
  }

  const { nonce, expiresAt } = generateNonce(address);
  res.json({
    nonce,
    expires_at: new Date(expiresAt).toISOString(),
    expires_in_seconds: Math.floor((expiresAt - Date.now()) / 1000),
    message: `Sign this nonce to prove wallet ownership. Nonce: ${nonce}`,
  });
});

// POST /auth/verify
authRouter.post("/verify", (req: Request, res: Response) => {
  const { address, nonce, signature } = req.body as {
    address?: string;
    nonce?: string;
    signature?: string; // base64-encoded bytes
  };

  if (!address || !nonce || !signature) {
    res.status(400).json({ error: "address, nonce, and signature required" });
    return;
  }

  // 1. Validate nonce (one-time, TTL-checked)
  if (!consumeNonce(address, nonce)) {
    res.status(401).json({ error: "Nonce invalid, expired, or already used" });
    return;
  }

  // 2. Verify Ed25519 signature
  // algosdk.verifyBytes prepends "MX" (same as signBytes) before verifying
  try {
    const nonceBytes = Buffer.from(nonce, "hex");
    const sigBytes   = Buffer.from(signature, "base64");
    const valid      = algosdk.verifyBytes(nonceBytes, sigBytes, address);

    if (!valid) {
      res.status(401).json({ error: "Signature verification failed" });
      return;
    }
  } catch {
    res.status(400).json({ error: "Malformed signature" });
    return;
  }

  // 3. Issue JWT
  const token = jwt.sign({ address }, JWT_SECRET, { expiresIn: JWT_EXPIRY_SEC });
  res.json({
    token,
    address,
    expires_in_seconds: JWT_EXPIRY_SEC,
    message: "Authenticated. Use token as Bearer in subsequent requests.",
  });
});

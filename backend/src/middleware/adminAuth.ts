/**
 * Admin Auth Middleware — Supabase JWT Verification
 *
 * Supabase cloud now signs user session tokens with ES256 (asymmetric key pair),
 * not HS256. Using jwt.verify() with SUPABASE_JWT_SECRET fails with "invalid algorithm".
 *
 * The correct approach: delegate verification to Supabase via auth.getUser(token).
 * This works regardless of the signing algorithm and handles token expiry correctly.
 */
import { Request, Response, NextFunction } from "express";
import { supabaseService } from "../services/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

function extractToken(req: Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: "Unauthorized: no session token provided" });
    return;
  }

  try {
    const { data: { user }, error } = await supabaseService.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: "Unauthorized: invalid or expired session" });
      return;
    }

    if (!ADMIN_EMAIL || user.email !== ADMIN_EMAIL) {
      res.status(403).json({ error: "Forbidden: not an admin account" });
      return;
    }

    next();
  } catch (err: any) {
    res.status(500).json({ error: "Auth check failed: " + err.message });
  }
}

/**
 * Non-blocking admin check — returns true/false for GET /orders and GET /orders/:id
 * to decide whether to return full or masked response.
 */
export async function isAdminRequestAsync(req: Request): Promise<boolean> {
  try {
    const token = extractToken(req);
    if (!token || !ADMIN_EMAIL) return false;
    const { data: { user }, error } = await supabaseService.auth.getUser(token);
    if (error || !user) return false;
    return user.email === ADMIN_EMAIL;
  } catch {
    return false;
  }
}

/**
 * Sync fallback for routes that haven't been updated to async yet.
 * Returns false (public view) — safe default.
 */
export function isAdminRequest(_req: Request): boolean {
  return false;
}

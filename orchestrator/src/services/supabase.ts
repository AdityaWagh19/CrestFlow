/**
 * Supabase Service Client (Orchestrator)
 *
 * Uses the service_role key to sync on-chain state to the database.
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const SUPABASE_URL              = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — DB sync disabled");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function syncOrderStatus(orderId: number, status: string, yieldMicro?: number) {
  if (!SUPABASE_URL) return;
  
  const updateData: any = { status, last_synced_at: new Date().toISOString() };
  if (yieldMicro !== undefined) updateData.yield_earned_microalgo = yieldMicro;

  // Timestamps for status transitions
  if (status === "INVESTED")  updateData.invested_at = new Date().toISOString();
  if (status === "REDEEMED")  updateData.redeemed_at = new Date().toISOString();
  if (status === "COMPLETED") updateData.completed_at = new Date().toISOString();
  if (status === "CANCELLED") updateData.cancelled_at = new Date().toISOString();

  try {
    await supabase.from("orders").update(updateData).eq("order_id", orderId);
  } catch (err: any) {
    console.error(`[Supabase] Sync failed for order ${orderId}:`, err.message);
  }
}

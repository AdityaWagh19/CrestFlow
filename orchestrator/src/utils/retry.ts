/**
 * Retry utility — wraps any async fn with exponential back-off.
 * Logs each failure so the orchestrator never silently drops an order.
 */
import * as logger from "./logger";

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  delayMs     = 5000
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isLast = attempt === maxAttempts;
      logger.warn(
        `${label} — attempt ${attempt}/${maxAttempts} failed: ${err.message}` +
        (isLast ? " — giving up" : ` — retrying in ${delayMs / 1000}s`)
      );
      if (!isLast) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  return null;
}

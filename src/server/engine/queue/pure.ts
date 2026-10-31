/** Queue policy (PURE, unit-tested). */

/** Delay before the next attempt: 30 s, 2 min, 8 min, 30 min, then 2 h. */
export function backoffMs(attempt: number): number {
  const steps = [30_000, 120_000, 480_000, 1_800_000, 7_200_000];
  return steps[Math.min(Math.max(attempt, 1), steps.length) - 1];
}

/**
 * The error kept on a job: its class and message only, cut short, with anything that looks like personal data
 * (digits runs such as phone or identity numbers, e-mail addresses) masked. Answers and document text never reach it.
 */
export function safeError(e: unknown): string {
  const name = e instanceof Error ? e.constructor.name : "Error";
  const msg = e instanceof Error ? e.message : String(e);
  const masked = msg.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[بريد]").replace(/\d{6,}/g, "[رقم]");
  return `${name}: ${masked}`.slice(0, 500);
}

/** Errors worth retrying (the database or a dependency was momentarily unavailable) versus errors of the data. */
export function retryable(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "40001", "40P01", "55P03", "53300"].includes(code)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /timeout|temporar|unavailable|ECONN/i.test(msg);
}

/**
 * Re-runs a whole transaction that PostgreSQL rejected with SQLSTATE 40001.
 *
 * Some outcomes SQL try-locks an advisory key and raises 40001 ("retry the transaction") instead
 * of waiting while it holds other keys. Such a try-lock can also lose to a transaction that has
 * already committed: PostgreSQL releases a finishing transaction's locks one lock partition at a
 * time and wakes waiters as it goes, so a waiter can resume and try-lock a key the committer has
 * not released yet (#819). Wrap only work that owns its transaction. Inside an outer transaction
 * the failed statement has already aborted it, and a retry there cannot succeed.
 */
export async function retryAflOutcomeSerializationFailure<T>(
  work: () => Promise<T>,
  { attempts = 3, delayMs = 25 }: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts || !isSerializationFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '40001';
}

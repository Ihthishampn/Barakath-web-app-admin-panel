/**
 * Human-readable message for a failed Cloud Function call. Operations
 * mutations (order status, refunds, wallet, block, affiliate) are CF-only by
 * design (money / cross-user / atomic). Until those functions are deployed the
 * calls fail with `not-found`; surface that clearly instead of a generic error.
 */
export function cfError(e: unknown, action: string): string {
  const code = (e as { code?: string })?.code ?? '';
  const message = (e as { message?: string })?.message;
  if (code.includes('not-found')) return `Couldn’t ${action}: it no longer exists or was already updated.`;
  if (code.includes('failed-precondition')) return message || `Couldn’t ${action}: not allowed in the current state.`;
  if (code.includes('invalid-argument')) return message || `Couldn’t ${action}: some details are invalid.`;
  if (code.includes('already-exists')) return message || `Couldn’t ${action}: it already exists.`;
  if (code.includes('permission-denied')) return `You don’t have permission to ${action}.`;
  if (code.includes('unauthenticated')) return `Your session expired — sign in again to ${action}.`;
  return `Couldn’t ${action}. Please try again.`;
}

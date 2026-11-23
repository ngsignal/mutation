type AbortReason = 'Aborted' | 'Dropped' | 'NotStarted' | 'Destroyed';

// Created on first use: `sideEffects: false` forbids module-level allocations.
let neverSentErrors: WeakSet<DOMException> | undefined;

export function abortError(reason: AbortReason): DOMException {
  const error = new DOMException(reason, 'AbortError');
  if (reason !== 'Aborted') {
    (neverSentErrors ??= new WeakSet()).add(error);
  }
  return error;
}

/**
 * For an error a `mutationFn` rejected with: its call ran, so its write may have left, even when
 * the error is another mutation's `'Dropped'`.
 */
export function markMaybeSent(error: unknown): void {
  if (error instanceof DOMException) {
    neverSentErrors?.delete(error);
  }
}

/**
 * Whether a call was cancelled before its `mutationFn` ran, so its write never left: dropped by
 * `concurrency: 'drop'`, still queued when `reset()` or destroy ran, or made after destroy.
 * False for a call aborted in flight (`'Aborted'`), whose write may have reached the server, and
 * for any error from `mutationFn`, even one another mutation rejected with: checking an HTTP
 * status is up to you.
 *
 * @example
 * ```ts
 * this.deleteUser.mutate(user).catch((error: unknown) => {
 *   const rejectedByServer = error instanceof HttpErrorResponse && error.status >= 400;
 *   if (wasNeverSent(error) || rejectedByServer) this.users.update((users) => [...users, user]);
 * });
 * ```
 */
export function wasNeverSent(error: unknown): boolean {
  return error instanceof DOMException && neverSentErrors?.has(error) === true;
}

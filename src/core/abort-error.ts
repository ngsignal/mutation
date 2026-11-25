type NeverSentReason = 'Dropped' | 'NotStarted' | 'Replaced' | 'Destroyed';

// Created on first use: `sideEffects: false` forbids module-level allocations.
let neverSentErrors: WeakSet<DOMException> | undefined;

/** A call aborted in flight: its write may have reached the server. */
export function abortedError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** A call rejected before its `mutationFn` ran: `wasNeverSent()` is true for it. */
export function neverSentError(reason: NeverSentReason): DOMException {
  const error = new DOMException(reason, 'AbortError');
  (neverSentErrors ??= new WeakSet()).add(error);
  return error;
}

/**
 * For an error a `mutationFn` rejected with: its call ran, so its write may have left, even when
 * the error is another mutation's `'Dropped'`. The error object is shared with that mutation's
 * caller, so `wasNeverSent()` turns false for it too once this runs.
 */
export function markMaybeSent(error: unknown): void {
  if (error instanceof DOMException) {
    neverSentErrors?.delete(error);
  }
}

/**
 * Whether a call was cancelled before its `mutationFn` ran, so its write never left: dropped by
 * `concurrency: 'drop'`, replaced by a newer call with `concurrency: 'queue-latest'`, still queued
 * when `reset()` or destroy ran, or made after destroy.
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

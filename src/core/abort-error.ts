type AbortReason = 'Aborted' | 'Dropped' | 'NotStarted' | 'Destroyed';

export function abortError(reason: AbortReason): DOMException {
  return new DOMException(reason, 'AbortError');
}

/**
 * Whether a call was cancelled before its `mutationFn` ran, so its write never left: dropped by
 * `concurrency: 'drop'`, still queued when `reset()` or destroy ran, or made after destroy.
 * False for a call aborted in flight (`'Aborted'`), whose write may have reached the server, and
 * for any error from `mutationFn`: checking an HTTP status is up to you.
 *
 * @example
 * ```ts
 * this.deleteUser.mutate(user).catch((error) => {
 *   if (wasNeverSent(error)) this.users.update((users) => [...users, user]);
 * });
 * ```
 */
export function wasNeverSent(error: unknown): error is DOMException {
  if (!(error instanceof DOMException) || error.name !== 'AbortError') {
    return false;
  }
  const reason = error.message as AbortReason;
  return reason === 'Dropped' || reason === 'NotStarted' || reason === 'Destroyed';
}

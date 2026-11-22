/** Why a call rejected with an `AbortError`: the public contract of the README's Cancellations table. */
export type AbortReason = 'Aborted' | 'Dropped' | 'NotStarted' | 'Destroyed';

export function abortError(reason: AbortReason): DOMException {
  return new DOMException(reason, 'AbortError');
}

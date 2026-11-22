export type AbortReason = 'Aborted' | 'Dropped' | 'NotStarted' | 'Destroyed';

export function abortError(reason: AbortReason): DOMException {
  return new DOMException(reason, 'AbortError');
}

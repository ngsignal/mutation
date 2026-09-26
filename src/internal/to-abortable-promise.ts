import type { Observable } from 'rxjs';

/**
 * Resolves with the first value of `source`, rejects on its error or if it completes empty, and
 * unsubscribes (rejecting with an AbortError) as soon as `abortSignal` aborts. Subscribes by hand
 * rather than with `firstValueFrom`/root-level operators so it runs on RxJS 6 and 7 alike.
 */
const abortError = () => new DOMException('Aborted', 'AbortError');

export function toAbortablePromise<T>(source: Observable<T>, abortSignal: AbortSignal, emptyMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    let subscription: { unsubscribe(): void } | undefined;
    const settle = (applyOutcome: () => void) => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener('abort', onAbort);
      subscription?.unsubscribe();
      applyOutcome();
    };
    const onAbort = () => settle(() => reject(abortError()));
    abortSignal.addEventListener('abort', onAbort, { once: true });
    subscription = source.subscribe({
      next: (value) => settle(() => resolve(value)),
      error: (error: unknown) => settle(() => reject(error)),
      complete: () => settle(() => reject(new Error(emptyMessage))),
    });
    // A synchronous source settles before `subscription` is assigned.
    if (settled) subscription.unsubscribe();
  });
}

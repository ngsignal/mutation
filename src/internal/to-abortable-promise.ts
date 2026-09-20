import type { Observable, Subscription } from 'rxjs';

/**
 * Resolves with the first value of `source`, rejects on its error or if it completes empty, and
 * unsubscribes (rejecting with `abortSignal.reason`, an AbortError by default) as soon as
 * `abortSignal` aborts. Subscribes by hand because `firstValueFrom` is RxJS 7+, like
 * `rxResource()` does.
 */
export function toAbortablePromise<T>(source: Observable<T>, abortSignal: AbortSignal, emptyMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(abortSignal.reason);
      return;
    }

    let settled = false;
    let subscription: Subscription | undefined;

    const settle = (applyOutcome: () => void) => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener('abort', onAbort);
      subscription?.unsubscribe();
      applyOutcome();
    };

    const onAbort = () => settle(() => reject(abortSignal.reason));
    abortSignal.addEventListener('abort', onAbort);

    subscription = source.subscribe({
      next: (value) => settle(() => resolve(value)),
      error: (error: unknown) => settle(() => reject(error)),
      complete: () => settle(() => reject(new Error(emptyMessage))),
    });
    // A synchronous source settles before `subscription` is assigned.
    if (settled) subscription.unsubscribe();
  });
}

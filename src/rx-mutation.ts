import { assertInInjectionContext } from '@angular/core';
import type { Observable } from 'rxjs';
import { toAbortablePromise } from './internal/to-abortable-promise.js';
import { mutation } from './mutation.js';
import type { MutationOptions, MutationRef } from './mutation.types.js';

export interface RxMutationOptions<TInput, TOutput, TError = unknown>
  extends Omit<MutationOptions<TInput, TOutput, TError>, 'mutationFn'> {
  mutationFn: (input: TInput) => Observable<TOutput>;
}

/**
 * `mutation()` for Observable-returning calls, the mutation counterpart of `rxResource()`. Unlike
 * `rxResource()`, only the first emitted value is kept: it resolves the call, then the Observable
 * is unsubscribed. Completing without a value rejects; aborting unsubscribes.
 */
export function rxMutation<TInput, TOutput, TError = unknown>(
  options: RxMutationOptions<TInput, TOutput, TError>,
): MutationRef<TInput, TOutput, TOutput | undefined, TError> {
  if (!options.injector) {
    assertInInjectionContext(rxMutation);
  }
  const { mutationFn, ...mutationOptions } = options;
  return mutation<TInput, TOutput, TError>({
    ...mutationOptions,
    mutationFn: (input, abortSignal) =>
      toAbortablePromise(mutationFn(input), abortSignal, 'Observable completed without emitting a value'),
  });
}

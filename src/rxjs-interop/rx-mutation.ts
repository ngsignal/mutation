import { assertInInjectionContext } from '@angular/core';
import type { Observable } from 'rxjs';
import { mutation } from '../core/mutation.js';
import type { MutationOptions, MutationRef } from '../core/mutation.types.js';
import { toAbortablePromise } from '../internal/to-abortable-promise.js';

/** Options of `rxMutation()`: `mutation()`'s options, with a `mutationFn` that returns an Observable. */
export interface RxMutationOptions<TInput, TOutput, TError = unknown>
  extends Omit<MutationOptions<TInput, TOutput, TError>, 'mutationFn'> {
  /** Performs the write for one call, e.g. an existing service method. `reset()` and destroy unsubscribe. */
  mutationFn: (input: TInput) => Observable<TOutput>;
}

/**
 * Creates a mutation whose `mutationFn` returns an Observable, the mutation counterpart of
 * `rxResource()`. The call resolves with the last value once the Observable completes, like
 * `lastValueFrom()`: one that never completes keeps the call pending until `reset()` or destroy.
 * Completing without a value rejects with `Error('Observable completed without emitting a value')`.
 *
 * Must run in an injection context, or receive `options.injector`.
 *
 * @example
 * ```ts
 * readonly createUser = rxMutation<CreateUserDto, User>({
 *   mutationFn: (dto) => this.userService.create(dto),
 * });
 * ```
 *
 * @see https://github.com/ngsignal/mutation/blob/main/docs/RECIPES.md#reusing-an-observable-returning-service
 */
export function rxMutation<TInput = void, TOutput = unknown, TError = unknown>(
  options: RxMutationOptions<TInput, TOutput, TError>,
): MutationRef<TInput, TOutput, TError> {
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

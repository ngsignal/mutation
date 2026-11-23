import { assertInInjectionContext } from '@angular/core';
import type { Observable } from 'rxjs';
import { noExtraContext, type NoExtraContext } from '../core/mutation-adapter.js';
import { createMutation } from '../core/mutation.js';
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
 * `rxResource()`. The call resolves with the last value, once the Observable completes.
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
  return createMutation<TInput, TOutput, TError, NoExtraContext>(options, {
    createContext: noExtraContext,
    run: (input, { abortSignal }) =>
      toAbortablePromise(options.mutationFn(input), abortSignal, 'Observable completed without emitting a value'),
  });
}

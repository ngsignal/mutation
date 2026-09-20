import {
  signal,
  computed,
  untracked,
  inject,
  Injector,
  DestroyRef,
  assertInInjectionContext,
  PendingTasks,
} from '@angular/core';
import type {
  MutationOptions,
  MutationRef,
  MutationSnapshot,
  MutationStatus,
} from './mutation.types.js';

/**
 * Low-level primitive for mutations (POST/PUT/DELETE), designed to
 * complement resource()/httpResource() which deliberately only cover
 * reads.
 *
 * Implementation choices directly inspired by packages/core/src/resource/resource.ts:
 *  - raw WritableSignals for internal state
 *  - a generation counter so only the current call's outcome ever reaches the signals
 *  - PendingTasks for SSR stability (ApplicationRef.isStable)
 *  - DestroyRef to ignore the result if the context is destroyed in flight
 *
 */
export function mutation<TInput, TOutput, TError = unknown>(
  options: MutationOptions<TInput, TOutput, TError>,
): MutationRef<TInput, TOutput, TOutput | undefined, TError> {
  if (!options.injector) {
    assertInInjectionContext(mutation);
  }
  const injector = options.injector ?? inject(Injector);
  const destroyRef = injector.get(DestroyRef);
  const pendingTasks = injector.get(PendingTasks);

  const status = signal<MutationStatus>('idle');
  const value = signal<TOutput | undefined>(undefined);
  const error = signal<TError | undefined>(undefined);
  const currentInput = signal<TInput | undefined>(undefined);

  let generation = 0;
  let destroyed = false;
  const activeCalls = new Map<AbortController, () => void>();

  function abortAllInProgress(): void {
    for (const [controller, removeTask] of activeCalls) {
      controller.abort();
      removeTask();
    }
    activeCalls.clear();
  }

  destroyRef.onDestroy(() => {
    destroyed = true;
    generation++;
    abortAllInProgress();
  });

  function reset(): void {
    generation++;
    abortAllInProgress();
    status.set('idle');
    value.set(undefined);
    error.set(undefined);
    currentInput.set(undefined);
  }

  function commitSuccess(result: TOutput, input: TInput, expectedGeneration: number): void {
    if (destroyed || expectedGeneration !== generation) {
      return;
    }
    value.set(result);
    status.set('success');
    options.onSuccess?.(result, input);
    options.onSettled?.(result, undefined, input);
  }

  function commitError(err: TError, input: TInput, expectedGeneration: number): void {
    if (destroyed || expectedGeneration !== generation) {
      return;
    }
    error.set(err);
    status.set('error');
    options.onError?.(err, input);
    options.onSettled?.(undefined, err, input);
  }

  async function mutate(input: TInput): Promise<TOutput> {
    const currentGeneration = ++generation;

    const abortController = new AbortController();

    untracked(() => {
      status.set('pending');
      error.set(undefined);
      currentInput.set(input);
    });

    const removeTask = pendingTasks.add();
    activeCalls.set(abortController, removeTask);

    try {
      const result = await untracked(() => options.mutationFn(input, abortController.signal));
      commitSuccess(result, input, currentGeneration);
      return result;

    } catch (err) {
      commitError(err as TError, input, currentGeneration);
      throw err;

    } finally {
      removeTask();
      activeCalls.delete(abortController);
    }
  }

  const snapshot = computed<MutationSnapshot<TOutput, TError>>(() => {
    const currentStatus = status();
    switch (currentStatus) {
      case 'idle':
        return { status: currentStatus, value: undefined, error: undefined };
      case 'pending':
        return { status: currentStatus, value: value(), error: undefined };
      case 'success':
        return { status: currentStatus, value: value() as TOutput, error: undefined };
      case 'error':
        return { status: currentStatus, value: value(), error: error() as TError };
    }
  });

  return {
    status: status.asReadonly(),
    value: value.asReadonly(),
    error: error.asReadonly(),
    input: currentInput.asReadonly(),
    isPending: computed(() => status() === 'pending'),
    snapshot,
    hasValue(): this is MutationRef<TInput, TOutput, TOutput, TError> {
      return value() !== undefined;
    },
    mutate,
    reset,
  };
}

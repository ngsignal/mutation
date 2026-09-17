import {
  signal,
  computed,
  untracked,
  inject,
  Injector,
  DestroyRef,
  assertInInjectionContext,
  PendingTasks,
  type Signal,
} from '@angular/core';

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

export interface MutationOptions<TInput, TOutput, TError = unknown> {
  mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>;
  onSuccess?: (output: TOutput, input: TInput) => void;
  onError?: (error: TError, input: TInput) => void;
  injector?: Injector;
}

export interface MutationRef<TInput, TOutput, TValue = TOutput | undefined, TError = unknown> {
  readonly status: Signal<MutationStatus>;
  readonly value: Signal<TValue>;
  readonly error: Signal<TError | undefined>;
  readonly isPending: Signal<boolean>;
  hasValue(): this is MutationRef<TInput, TOutput, TOutput>;
  mutate(input: TInput): Promise<TOutput>;
  reset(): void;
}

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

  let generation = 0;
  let destroyed = false;
  const activeAbortControllers = new Set<AbortController>();
  const activeRemoveTasks = new Set<() => void>();

  function abortAllInProgress(): void {
    for (const controller of activeAbortControllers) {
      controller.abort();
    }
    activeAbortControllers.clear();
    for (const removeTask of activeRemoveTasks) {
      removeTask();
    }
    activeRemoveTasks.clear();
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
  }

  function commitSuccess(result: TOutput, input: TInput, expectedGeneration: number): void {
    if (destroyed || expectedGeneration !== generation) {
      return;
    }
    
    untracked(() => {
      value.set(result);
      status.set('success');
    });
    options.onSuccess?.(result, input);
  }

  function commitError(err: TError, input: TInput, expectedGeneration: number): void {
    if (destroyed || expectedGeneration !== generation) {
      return;
    }

    untracked(() => {
      error.set(err);
      status.set('error');
    });

    options.onError?.(err, input);
  }

  async function mutate(input: TInput): Promise<TOutput> {
    const currentGeneration = ++generation;

    const abortController = new AbortController();
    activeAbortControllers.add(abortController);

    untracked(() => {
      status.set('pending');
      error.set(undefined);
    });

    const removeTask = pendingTasks.add();
    activeRemoveTasks.add(removeTask);

    try {
      const result = await untracked(() => options.mutationFn(input, abortController.signal));
      commitSuccess(result, input, currentGeneration);
      return result;

    } catch (err) {
      commitError(err as TError, input, currentGeneration);
      throw err;

    } finally {
      removeTask();
      activeRemoveTasks.delete(removeTask);
      activeAbortControllers.delete(abortController);
    }
  }

  return {
    status: status.asReadonly(),
    value: value.asReadonly(),
    error: error.asReadonly(),
    isPending: computed(() => status() === 'pending'),
    hasValue(): this is MutationRef<TInput, TOutput, TOutput> {
      return value() !== undefined;
    },
    mutate,
    reset,
  };
}

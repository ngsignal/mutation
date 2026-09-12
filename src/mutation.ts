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

export interface MutationOptions<TInput, TOutput> {
  mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>;
  onSuccess?: (output: TOutput, input: TInput) => void;
  onError?: (error: unknown, input: TInput) => void;
  injector?: Injector;
}

export interface MutationRef<TInput, TOutput> {
  readonly status: Signal<MutationStatus>;
  readonly value: Signal<TOutput | undefined>;
  readonly error: Signal<unknown>;
  readonly isPending: Signal<boolean>;
  mutate(input: TInput): Promise<TOutput | undefined>;
  reset(): void;
}

/**
 * Low-level primitive for mutations (POST/PUT/DELETE), designed to
 * complement resource()/httpResource() which deliberately only cover
 * reads.
 *
 * Implementation choices directly inspired by packages/core/src/resource/resource.ts:
 *  - raw WritableSignals for internal state
 *  - a generation counter to ignore responses from stale requests
 *  - PendingTasks for SSR stability (ApplicationRef.isStable)
 *  - DestroyRef to ignore the result if the context is destroyed in flight
 */
export function mutation<TInput, TOutput>(
  options: MutationOptions<TInput, TOutput>,
): MutationRef<TInput, TOutput> {
  if (!options.injector) {
    assertInInjectionContext(mutation);
  }
  const injector = options.injector ?? inject(Injector);
  const destroyRef = injector.get(DestroyRef);
  const pendingTasks = injector.get(PendingTasks);

  const status = signal<MutationStatus>('idle');
  const value = signal<TOutput | undefined>(undefined);
  const error = signal<unknown>(undefined);

  let generation = 0;
  let destroyed = false;
  let activeAbortController: AbortController | undefined;
  let activeRemoveTask: (() => void) | undefined;

  /**
   * Aborts the in-flight mutation, if any, and immediately releases its PendingTask so
   * SSR/zoneless stability doesn't wait on a request we no longer care about.
   */
  function abortInProgress(): void {
    activeAbortController?.abort();
    activeAbortController = undefined;
    activeRemoveTask?.();
    activeRemoveTask = undefined;
  }

  destroyRef.onDestroy(() => {
    destroyed = true;
    abortInProgress();
  });

  function reset(): void {
    generation++;
    abortInProgress();
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

  function commitError(err: unknown, input: TInput, expectedGeneration: number): void {
    if (destroyed || expectedGeneration !== generation) {
      return;
    }

    untracked(() => {
      error.set(err);
      status.set('error');
    });

    options.onError?.(err, input);
  }

  async function mutate(input: TInput): Promise<TOutput | undefined> {
    const currentGeneration = ++generation;

    abortInProgress();
    const abortController = new AbortController();
    activeAbortController = abortController;

    untracked(() => {
      status.set('pending');
      error.set(undefined);
    });

    // Captured locally since `activeRemoveTask`/`activeAbortController` may already point to a
    // newer mutation's own state by the time this one settles.
    activeRemoveTask = pendingTasks.add();
    let removeTask: (() => void) | undefined = activeRemoveTask;

    try {
      const result = await untracked(() => options.mutationFn(input, abortController.signal));
      commitSuccess(result, input, currentGeneration);
      return result;

    } catch (err) {
      commitError(err, input, currentGeneration);

      // A superseded call's rejection (like AbortSignal) isn't a real
      // failure of this call's request, so only the still-current call propagates it.
      if (currentGeneration === generation) {
        throw err;
      }
      return undefined;

    } finally {
      removeTask?.();
      // Only clear the shared references if they still point at this call's own state; a newer
      // mutate() may already have replaced them via abortInProgress() while this one was settling.
      if (activeRemoveTask === removeTask) {
        activeRemoveTask = undefined;
      }
      if (activeAbortController === abortController) {
        activeAbortController = undefined;
      }
      removeTask = undefined;
    }
  }

  return {
    status: status.asReadonly(),
    value: value.asReadonly(),
    error: error.asReadonly(),
    isPending: computed(() => status() === 'pending'),
    mutate,
    reset,
  };
}

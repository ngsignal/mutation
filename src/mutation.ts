import {
  signal,
  computed,
  untracked,
  inject,
  Injector,
  DestroyRef,
  ErrorHandler,
  assertInInjectionContext,
  PendingTasks,
} from '@angular/core';
import type {
  MutationCallbackContext,
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
 *    (callbacks still run for every call, with `isLatest` telling them apart)
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
  const errorHandler = injector.get(ErrorHandler, null);

  const status = signal<MutationStatus>('idle');
  const value = signal<TOutput | undefined>(undefined);
  const error = signal<TError | undefined>(undefined);
  const currentInput = signal<TInput | undefined>(undefined);

  let generation = 0;
  let destroyed = false;
  const activeCalls = new Map<AbortController, () => void>();
  let dropLocked = false;

  // Promise-queue pattern. queueTail always settles so one failed call
  // never blocks the ones queued after it.
  let queueTail: Promise<void> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queueTail.then(task, task);
    queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function abortAllInProgress(): void {
    for (const [controller, removeTask] of activeCalls) {
      controller.abort();
      removeTask();
    }
    activeCalls.clear();
    dropLocked = false;
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

  function settledCallContext(
    expectedGeneration: number,
    abortSignal: AbortSignal,
  ): MutationCallbackContext | undefined {
    if (destroyed || abortSignal.aborted) {
      return undefined;
    }
    return { isLatest: expectedGeneration === generation };
  }

  function commitSuccess(result: TOutput, input: TInput, context: MutationCallbackContext | undefined): void {
    if (!context) {
      return;
    }
    if (context.isLatest) {
      dropLocked = false;
      value.set(result);
      status.set('success');
    }
    runCallback(() => options.onSuccess?.(result, input, context));
    runCallback(() => options.onSettled?.(result, undefined, input, context));
  }

  function commitError(err: TError, input: TInput, context: MutationCallbackContext | undefined): void {
    if (!context) {
      return;
    }
    if (context.isLatest) {
      dropLocked = false;
      error.set(err);
      status.set('error');
    }
    runCallback(() => options.onError?.(err, input, context));
    runCallback(() => options.onSettled?.(undefined, err, input, context));
  }

  // Like OutputEmitterRef.emit(): a throwing callback is reported, it never rewrites the call's outcome.
  function runCallback(callback: () => void): void {
    try {
      callback();
    } catch (callbackError) {
      errorHandler?.handleError(callbackError);
    }
  }

  function mutate(input: TInput): Promise<TOutput> {
    const call = startCall(input);
    // Marks the call as handled so a caller that ignores it does not get an unhandled rejection;
    call.catch(() => undefined);
    return call;
  }

  function startCall(input: TInput): Promise<TOutput> {
    if (destroyed) {
      return Promise.reject(new DOMException('Destroyed', 'AbortError'));
    }
    if (options.concurrency === 'drop') {
      if (dropLocked) {
        return Promise.reject(new DOMException('Dropped', 'AbortError'));
      }
      dropLocked = true;
    }
    return execute(input);
  }

  async function execute(input: TInput): Promise<TOutput> {
    const currentGeneration = ++generation;

    const abortController = new AbortController();

    untracked(() => {
      status.set('pending');
      error.set(undefined);
      currentInput.set(input);
    });

    const removeTask = pendingTasks.add();
    activeCalls.set(abortController, removeTask);

    function callMutationFn(): Promise<TOutput> {
      // Only a queued call can be aborted before it starts.
      if (abortController.signal.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      return untracked(() => options.mutationFn(input, abortController.signal));
    }

    try {
      const result = options.concurrency === 'queue' ? await enqueue(callMutationFn) : await callMutationFn();
      commitSuccess(result, input, settledCallContext(currentGeneration, abortController.signal));
      return result;

    } catch (err) {
      commitError(err as TError, input, settledCallContext(currentGeneration, abortController.signal));
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
    isIdle: computed(() => status() === 'idle'),
    isSuccess: computed(() => status() === 'success'),
    isError: computed(() => status() === 'error'),
    snapshot,
    hasValue(): this is MutationRef<TInput, TOutput, TOutput, TError> {
      return value() !== undefined;
    },
    mutate,
    reset,
  };
}

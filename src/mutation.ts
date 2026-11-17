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
  const gate = createConcurrencyGate(options.concurrency);
  const calls = createCallTracker(pendingTasks);

  function abortAllInProgress(): void {
    calls.abortAll();
    gate.release();
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
      gate.release();
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
      gate.release();
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
    if (!gate.admit()) {
      return Promise.reject(new DOMException('Dropped', 'AbortError'));
    }
    return execute(input);
  }

  async function execute(input: TInput): Promise<TOutput> {
    const currentGeneration = ++generation;

    untracked(() => {
      status.set('pending');
      error.set(undefined);
      currentInput.set(input);
    });

    const call = calls.start();

    function callMutationFn(): Promise<TOutput> {
      // Only a queued call can be aborted before it starts.
      if (call.abortSignal.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      return untracked(() => options.mutationFn(input, call.abortSignal));
    }

    try {
      const result = await gate.run(callMutationFn);
      commitSuccess(result, input, settledCallContext(currentGeneration, call.abortSignal));
      return result;

    } catch (err) {
      commitError(err as TError, input, settledCallContext(currentGeneration, call.abortSignal));
      throw err;

    } finally {
      call.finish();
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

interface ConcurrencyGate {
  admit(): boolean;
  run<T>(task: () => Promise<T>): Promise<T>;
  release(): void;
}

function createConcurrencyGate(concurrency: MutationOptions<unknown, unknown>['concurrency']): ConcurrencyGate {
  switch (concurrency) {
    case 'queue':
      return createQueueGate();
    case 'drop':
      return createDropGate();
    case undefined:
      return { admit: () => true, run: (task) => task(), release: () => undefined };
  }
}

function createQueueGate(): ConcurrencyGate {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    admit: () => true,
    run(task) {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
    release: () => undefined,
  };
}

function createDropGate(): ConcurrencyGate {
  let locked = false;
  return {
    admit() {
      if (locked) {
        return false;
      }
      locked = true;
      return true;
    },
    run: (task) => task(),
    release() {
      locked = false;
    },
  };
}

function createCallTracker(pendingTasks: PendingTasks) {
  const activeCalls = new Map<AbortController, () => void>();
  return {
    start() {
      const controller = new AbortController();
      const removeTask = pendingTasks.add();
      activeCalls.set(controller, removeTask);
      return {
        abortSignal: controller.signal,
        finish(): void {
          removeTask();
          activeCalls.delete(controller);
        },
      };
    },
    abortAll(): void {
      for (const [controller, removeTask] of activeCalls) {
        controller.abort();
        removeTask();
      }
      activeCalls.clear();
    },
  };
}

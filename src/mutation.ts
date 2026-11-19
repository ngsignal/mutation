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
 * Low-level primitive for mutations (POST/PUT/PATCH/DELETE), the write-side counterpart of
 * `resource()`, which only covers reads.
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
  const calls = createCallTracker<TInput>(pendingTasks);

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

    const call = untracked(() => {
      status.set('pending');
      error.set(undefined);
      currentInput.set(input);
      return calls.start(input);
    });

    try {
      const result = await gate.run(
        () => untracked(() => options.mutationFn(input, call.abortSignal)),
        call.abortSignal,
      );
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
    isPending: computed(() => calls.pendingInputs().length > 0),
    isIdle: computed(() => status() === 'idle'),
    isSuccess: computed(() => status() === 'success'),
    isError: computed(() => status() === 'error'),
    pendingInputs: calls.pendingInputs,
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
  run<T>(task: () => Promise<T>, abortSignal: AbortSignal): Promise<T>;
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
  let previousCall: Promise<unknown> = Promise.resolve();
  return {
    admit: () => true,
    run<T>(task: () => Promise<T>, abortSignal: AbortSignal) {
      return new Promise<T>((resolve, reject) => {
        // Aborted while waiting: reject now rather than when its turn comes.
        const leaveQueue = () => reject(notStartedError());
        abortSignal.addEventListener('abort', leaveQueue, { once: true });

        const call = previousCall.then(() => {
          abortSignal.removeEventListener('abort', leaveQueue);
          return abortSignal.aborted ? Promise.reject(notStartedError()) : task();
        });
        // The next call waits for this one even if it left the queue: writes stay in order.
        previousCall = call.catch(() => undefined);
        call.then(resolve, reject);
      });
    },
    release: () => undefined,
  };
}

// Never sent, unlike a call aborted in flight ('Aborted'), whose request may already have left.
function notStartedError(): DOMException {
  return new DOMException('NotStarted', 'AbortError');
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

function createCallTracker<TInput>(pendingTasks: PendingTasks) {
  const activeCalls = new Map<AbortController, { input: TInput; removeTask: () => void }>();
  // A Map iterates in insertion order: the inputs stay in call order.
  const pendingInputs = signal<readonly TInput[]>([]);
  const publishInputs = () => pendingInputs.set(Array.from(activeCalls.values(), (call) => call.input));
  return {
    pendingInputs: pendingInputs.asReadonly(),
    start(input: TInput) {
      const controller = new AbortController();
      const removeTask = pendingTasks.add();
      activeCalls.set(controller, { input, removeTask });
      publishInputs();
      return {
        abortSignal: controller.signal,
        finish(): void {
          removeTask();
          activeCalls.delete(controller);
          publishInputs();
        },
      };
    },
    abortAll(): void {
      for (const [controller, { removeTask }] of activeCalls) {
        // A fixed reason: fetch(), rxMutation() and httpMutation() reject with it on every platform.
        controller.abort(new DOMException('Aborted', 'AbortError'));
        removeTask();
      }
      activeCalls.clear();
      pendingInputs.set([]);
    },
  };
}

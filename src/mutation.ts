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
): MutationRef<TInput, TOutput, TError> {
  if (!options.injector) {
    assertInInjectionContext(mutation);
  }
  const injector = options.injector ?? inject(Injector);
  const destroyRef = injector.get(DestroyRef);
  const pendingTasks = injector.get(PendingTasks);
  const errorHandler = injector.get(ErrorHandler, null);

  const named = (member: string) =>
    options.debugName === undefined ? undefined : { debugName: `${options.debugName}.${member}` };
  const status = signal<MutationStatus>('idle', named('status'));
  const value = signal<TOutput | undefined>(undefined, named('value'));
  const error = signal<TError | undefined>(undefined, named('error'));
  const currentInput = signal<TInput | undefined>(undefined, named('input'));

  let destroyed = false;
  const gate = createConcurrencyGate(options.concurrency);
  const calls = createCallTracker<TInput>(pendingTasks, named('pendingInputs'));

  destroyRef.onDestroy(() => {
    destroyed = true;
    calls.abortAll();
  });

  function reset(): void {
    calls.abortAll();
    status.set('idle');
    value.set(undefined);
    error.set(undefined);
    currentInput.set(undefined);
  }

  function settledCallContext(call: Call<TInput>): MutationCallbackContext | undefined {
    return call.abortSignal.aborted ? undefined : { isLatest: calls.isLatest(call) };
  }

  function commitSuccess(call: Call<TInput>, result: TOutput): void {
    const context = settledCallContext(call);
    if (!context) {
      return;
    }
    if (context.isLatest) {
      value.set(result);
      status.set('success');
    }
    runCallback(() => options.onSuccess?.(result, call.input, context));
    runCallback(() => options.onSettled?.(result, undefined, call.input, context));
  }

  function commitError(call: Call<TInput>, err: TError): void {
    const context = settledCallContext(call);
    if (!context) {
      return;
    }
    if (context.isLatest) {
      error.set(err);
      status.set('error');
    }
    runCallback(() => options.onError?.(err, call.input, context));
    runCallback(() => options.onSettled?.(undefined, err, call.input, context));
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
      commitSuccess(call, result);
      return result;

    } catch (err) {
      commitError(call, err as TError);
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
    hasValue(): this is MutationRef<TInput, TOutput, TError, TOutput> {
      return value() !== undefined;
    },
    mutate,
    reset,
  };
}

/** A concurrency mode: it frees what it holds by itself, when the call settles or aborts. */
interface ConcurrencyGate {
  admit(): boolean;
  run<T>(task: () => Promise<T>, abortSignal: AbortSignal): Promise<T>;
}

function createConcurrencyGate(concurrency: MutationOptions<unknown, unknown>['concurrency']): ConcurrencyGate {
  switch (concurrency) {
    case 'queue':
      return createQueueGate();
    case 'drop':
      return createDropGate();
    case 'parallel':
    case undefined:
      return { admit: () => true, run: (task) => task() };
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
  };
}

function notStartedError(): DOMException {
  return new DOMException('NotStarted', 'AbortError');
}

function createDropGate(): ConcurrencyGate {
  let locked = false;
  let holder: AbortSignal | undefined;
  return {
    admit() {
      if (locked) {
        return false;
      }
      locked = true;
      return true;
    },
    run(task, abortSignal) {
      holder = abortSignal;
      // An aborted call that settles later must not unlock a newer call: only the holder can.
      const unlock = () => {
        abortSignal.removeEventListener('abort', unlock);
        if (holder === abortSignal) {
          holder = undefined;
          locked = false;
        }
      };
      abortSignal.addEventListener('abort', unlock);
      return callAsPromise(task).finally(unlock);
    },
  };
}

function callAsPromise<T>(task: () => Promise<T>): Promise<T> {
  try {
    return task();
  } catch (error) {
    return Promise.reject(error);
  }
}

/** A `mutate()` admitted by the concurrency gate. */
interface Call<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
  finish(): void;
}

/** A newer call, `reset()` or destroy makes a call no longer the latest; only `reset()` and destroy abort it. */
function createCallTracker<TInput>(pendingTasks: PendingTasks, signalOptions?: { debugName: string }) {
  const activeCalls = new Map<Call<TInput>, { controller: AbortController; removeTask: () => void }>();
  let latest: Call<TInput> | undefined;
  const pendingInputs = signal<readonly TInput[]>([], signalOptions);
  const publishInputs = () => pendingInputs.set(Array.from(activeCalls.keys(), (call) => call.input));
  return {
    pendingInputs: pendingInputs.asReadonly(),
    start(input: TInput): Call<TInput> {
      const controller = new AbortController();
      const removeTask = pendingTasks.add();
      const call: Call<TInput> = {
        input,
        abortSignal: controller.signal,
        finish(): void {
          removeTask();
          activeCalls.delete(call);
          publishInputs();
        },
      };
      activeCalls.set(call, { controller, removeTask });
      latest = call;
      publishInputs();
      return call;
    },
    isLatest: (call: Call<TInput>) => call === latest,
    abortAll(): void {
      for (const { controller, removeTask } of activeCalls.values()) {
        controller.abort(new DOMException('Aborted', 'AbortError'));
        removeTask();
      }
      activeCalls.clear();
      latest = undefined;
      pendingInputs.set([]);
    },
  };
}

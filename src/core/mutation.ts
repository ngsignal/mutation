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
import { markMaybeSent, neverSentError } from './abort-error.js';
import { createCallTracker, type Call } from './call-tracker.js';
import { createConcurrencyGate } from './concurrency.js';
import {
  noExtraContext,
  type MutationAdapter,
  type MutationAdapterOptions,
  type NoExtraContext,
} from './mutation-adapter.js';
import { IDLE, failed, started, succeeded, type MutationState } from './mutation-state.js';
import type {
  MutationOptions,
  MutationRef,
} from './mutation.types.js';

/**
 * Creates a mutation: a write (POST, PUT, PATCH, DELETE) whose state is exposed as signals, the
 * write-side counterpart of `resource()`, which only covers reads. Calls never abort each other:
 * the signals follow the latest one.
 *
 * Must run in an injection context, or receive `options.injector`.
 *
 * @example
 * ```ts
 * readonly createTodo = mutation<string, Todo>({
 *   mutationFn: (title, abortSignal) => this.api.createTodo(title, abortSignal),
 * });
 * ```
 *
 * @see https://github.com/ngsignal/mutation#readme
 */
export function mutation<TInput = void, TOutput = unknown, TError = unknown>(
  options: MutationOptions<TInput, TOutput, TError>,
): MutationRef<TInput, TOutput, TError> {
  if (!options.injector) {
    assertInInjectionContext(mutation);
  }
  return createMutation<TInput, TOutput, TError, NoExtraContext>(options, {
    createContext: noExtraContext,
    run: (input, call) => options.mutationFn(input, call.abortSignal),
  });
}

/** Shared by `mutation()` and its adapters, which check the injection context first. */
export function createMutation<TInput, TOutput, TError, TExtra extends object>(
  options: MutationAdapterOptions<TInput, TOutput, TError, TExtra>,
  adapter: MutationAdapter<TInput, TOutput, TExtra>,
): MutationRef<TInput, TOutput, TError> {
  const injector = options.injector ?? inject(Injector);
  const destroyRef = injector.get(DestroyRef);
  const pendingTasks = injector.get(PendingTasks);
  const errorHandler = injector.get(ErrorHandler, null);

  const named = (member: string) =>
    options.debugName === undefined ? undefined : { debugName: `${options.debugName}.${member}` };
  type State = MutationState<TInput, TOutput, TError>;
  const state = signal<State>(IDLE, named('state'));
  const snapshot = computed(() => state().snapshot, named('snapshot'));
  const status = computed(() => snapshot().status, named('status'));
  const value = computed(() => snapshot().value, named('value'));
  const error = computed(() => snapshot().error, named('error'));
  const currentInput = computed(() => state().input, named('input'));
  const isIdle = computed(() => status() === 'idle');
  const isSuccess = computed(() => status() === 'success');
  const isError = computed(() => status() === 'error');

  const gate = createConcurrencyGate(options.concurrency);
  const calls = createCallTracker<TInput>(pendingTasks, destroyRef, named('pendingInputs'));
  const isPending = computed(() => calls.pendingInputs().length > 0);

  // Back to idle before aborting, so a call that an abort listener starts keeps its state.
  function reset(): void {
    state.set(IDLE);
    adapter.onReset?.();
    calls.abortAll();
  }

  /**
   * Settles `call`: its state, if it is the latest, then its callbacks. A call aborted by `reset()`
   * or destroy commits nothing: the caller asked to forget it.
   */
  function commit(call: Call<TInput>, settle: (current: State) => State, notify: (isLatest: boolean) => void): void {
    call.finish(() => {
      if (call.abortSignal.aborted) {
        return;
      }
      const isLatest = calls.isLatest(call);
      if (isLatest) {
        state.update(settle);
      }
      notify(isLatest);
    });
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
    const outcome = admitCall(input);
    // Marks the call as handled so a caller that ignores it does not get an unhandled rejection.
    outcome.catch(() => undefined);
    return outcome;
  }

  function admitCall(input: TInput): Promise<TOutput> {
    if (destroyRef.destroyed) {
      return Promise.reject(neverSentError('Destroyed'));
    }
    if (!gate.admit()) {
      return Promise.reject(neverSentError('Dropped'));
    }
    return runCall(input);
  }

  async function runCall(input: TInput): Promise<TOutput> {
    const call = untracked(() => {
      state.update((current) => started(current, input));
      return calls.start(input);
    });

    const extra = adapter.createContext();
    let mutationFnStarted = false;
    try {
      const task = gate.run(() => {
        mutationFnStarted = true;
        return untracked(() => adapter.run(input, { abortSignal: call.abortSignal, context: extra }));
      }, call);
      // Still queued when aborted, the call never ran; once started, its write may have left.
      const abortReason = () => (mutationFnStarted ? call.abortSignal.reason : neverSentError('NotStarted'));
      const result = await rejectOnAbort(task, call.abortSignal, abortReason);
      commit(call, (current) => succeeded(current, result), (isLatest) => {
        const context = { ...extra, isLatest };
        runCallback(() => options.onSuccess?.(result, call.input, context));
        runCallback(() => options.onSettled?.(result, undefined, call.input, context));
      });
      return result;
    } catch (err) {
      if (mutationFnStarted) {
        markMaybeSent(err);
      }
      commit(call, (current) => failed(current, err as TError), (isLatest) => {
        const context = { ...extra, isLatest };
        runCallback(() => options.onError?.(err as TError, call.input, context));
        runCallback(() => options.onSettled?.(undefined, err as TError, call.input, context));
      });
      throw err;
    }
  }

  return {
    status,
    value,
    error,
    input: currentInput,
    isPending,
    isIdle,
    isSuccess,
    isError,
    pendingInputs: calls.pendingInputs,
    snapshot,
    hasValue(): this is MutationRef<TInput, TOutput, TError, TOutput> {
      return value() !== undefined;
    },
    mutate,
    reset,
  };
}

/**
 * Settles like `task`, or rejects with `abortReason()` as soon as `abortSignal` aborts, like
 * `fetch()`: neither a `mutationFn` that ignores the signal nor a queue holding the call can keep
 * `mutate()` pending. `task` keeps running, so a queue still waits for the write.
 */
function rejectOnAbort<T>(task: Promise<T>, abortSignal: AbortSignal, abortReason: () => unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason());
    abortSignal.addEventListener('abort', onAbort, { once: true });
    void task.then(resolve, reject).finally(() => abortSignal.removeEventListener('abort', onAbort));
  });
}

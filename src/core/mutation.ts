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
import { abortError } from './abort-error.js';
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
  MutationCallbackContext,
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
  const state = signal<MutationState<TInput, TOutput, TError>>(IDLE, named('state'));
  const snapshot = computed(() => state().snapshot, named('snapshot'));
  const status = computed(() => snapshot().status, named('status'));
  const value = computed(() => snapshot().value, named('value'));
  const error = computed(() => snapshot().error, named('error'));
  const currentInput = computed(() => state().input, named('input'));
  const isIdle = computed(() => status() === 'idle');
  const isSuccess = computed(() => status() === 'success');
  const isError = computed(() => status() === 'error');

  const gate = createConcurrencyGate(options.concurrency);
  const calls = createCallTracker<TInput>(pendingTasks, named('pendingInputs'));
  const isPending = computed(() => calls.pendingInputs().length > 0);

  destroyRef.onDestroy(() => calls.abortAll());

  // Back to idle before aborting, so a call that an abort listener starts keeps its state.
  function reset(): void {
    state.set(IDLE);
    adapter.onReset?.();
    calls.abortAll();
  }

  function settledCallContext(call: Call<TInput>, extra: TExtra): (MutationCallbackContext & TExtra) | undefined {
    return call.abortSignal.aborted ? undefined : { ...extra, isLatest: calls.isLatest(call) };
  }

  function commitSuccess(call: Call<TInput>, extra: TExtra, result: TOutput): void {
    const context = settledCallContext(call, extra);
    if (!context) {
      return;
    }
    if (context.isLatest) {
      state.update((current) => succeeded(current, result));
    }
    runCallback(() => options.onSuccess?.(result, call.input, context));
    runCallback(() => options.onSettled?.(result, undefined, call.input, context));
  }

  function commitError(call: Call<TInput>, extra: TExtra, err: TError): void {
    const context = settledCallContext(call, extra);
    if (!context) {
      return;
    }
    if (context.isLatest) {
      state.update((current) => failed(current, err));
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
    const call = admitCall(input);
    // Marks the call as handled so a caller that ignores it does not get an unhandled rejection.
    call.catch(() => undefined);
    return call;
  }

  function admitCall(input: TInput): Promise<TOutput> {
    if (destroyRef.destroyed) {
      return Promise.reject(abortError('Destroyed'));
    }
    if (!gate.admit()) {
      return Promise.reject(abortError('Dropped'));
    }
    return runCall(input);
  }

  async function runCall(input: TInput): Promise<TOutput> {
    const call = untracked(() => {
      state.update((current) => started(current, input));
      return calls.start(input);
    });

    const extra = adapter.createContext();
    try {
      const result = await gate.run(
        () => untracked(() => adapter.run(input, { abortSignal: call.abortSignal, context: extra })),
        call.abortSignal,
      );
      call.finish(() => commitSuccess(call, extra, result));
      return result;

    } catch (err) {
      call.finish(() => commitError(call, extra, err as TError));
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

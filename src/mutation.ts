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
import { IDLE, failed, started, succeeded, type MutationState } from './mutation-state.js';
import type {
  MutationCallbackContext,
  MutationOptions,
  MutationRef,
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

  function reset(): void {
    calls.abortAll();
    state.set(IDLE);
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
      state.update((current) => succeeded(current, result));
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

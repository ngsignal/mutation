import type { Injector, Signal } from '@angular/core';

/** Outcome of the latest call: `'idle'` before the first call and after `reset()`. */
export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

/** Passed to every callback: `isLatest` is false for a call superseded by a more recent `mutate()`. */
export interface MutationCallbackContext {
  readonly isLatest: boolean;
}

/**
 * Callbacks run once for every call that settles, superseded or not, except calls aborted by
 * `reset()` or destroy. Only the latest call writes the signals.
 *
 * `TError` is an assertion, not a check: `error()` and `onError` receive whatever `mutationFn`
 * rejects with, an `AbortError` included.
 */
export interface MutationOptions<TInput, TOutput, TError = unknown> {
  /** `abortSignal` aborts on `reset()` or destroy only, never when a newer call supersedes this one. */
  mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>;
  onSuccess?: (output: TOutput, input: TInput, context: MutationCallbackContext) => void;
  onError?: (error: TError, input: TInput, context: MutationCallbackContext) => void;
  onSettled?: (
    output: TOutput | undefined,
    error: TError | undefined,
    input: TInput,
    context: MutationCallbackContext,
  ) => void;
  /** `'parallel'` (the default): calls run at once. `'queue'`: one at a time, in order. `'drop'`: rejects a call made while one is pending. */
  concurrency?: 'parallel' | 'queue' | 'drop';
  /** Needed outside an injection context. Destroying it aborts in-flight calls, like `reset()`. */
  injector?: Injector;
  /** Names the state signals in Angular DevTools: `'save'` gives `save.status`, `save.value`, … */
  debugName?: string;
}

/** `status`, `value` and `error` read together, narrowed by `status`. Like `ResourceSnapshot`, it has no input: read `input()`. */
export type MutationSnapshot<TOutput, TError = unknown> =
  | Readonly<{ status: 'idle'; value: undefined; error: undefined }>
  | Readonly<{ status: 'pending'; value: TOutput | undefined; error: undefined }>
  | Readonly<{ status: 'success'; value: TOutput; error: undefined }>
  | Readonly<{ status: 'error'; value: TOutput | undefined; error: TError }>;

/** Returned by `mutation()` and `rxMutation()`. Not meant to be implemented by hand: a minor version may add members. */
export interface MutationRef<TInput, TOutput, TError = unknown, TValue = TOutput | undefined> {
  /** Follows the latest call only: a superseded call never writes it. */
  readonly status: Signal<MutationStatus>;
  /** Kept while a newer call is pending or after it fails: only a new success or `reset()` replaces it. */
  readonly value: Signal<TValue>;
  /** Error of the latest call, cleared when a new call starts. */
  readonly error: Signal<TError | undefined>;
  /** Input of the latest call, set when `mutate()` is called. */
  readonly input: Signal<TInput | undefined>;
  /** True while any call is in flight, superseded and queued ones included, unlike `status()`, which follows the latest call. */
  readonly isPending: Signal<boolean>;
  readonly isIdle: Signal<boolean>;
  readonly isSuccess: Signal<boolean>;
  readonly isError: Signal<boolean>;
  /** Inputs of the calls still in flight, in call order, superseded and queued ones included: `input()` only tracks the latest call. */
  readonly pendingInputs: Signal<readonly TInput[]>;
  readonly snapshot: Signal<MutationSnapshot<TOutput, TError>>;
  /** Always false for a `void` mutation: check `isSuccess()` instead. */
  hasValue(): this is MutationRef<TInput, TOutput, TError, TOutput>;
  /** Safe to ignore: a failure never reports an unhandled rejection. */
  mutate(input: TInput): Promise<TOutput>;
  /** Aborts in-flight calls, but never undoes a write the server already received. */
  reset(): void;
}

import type { Injector, Signal } from '@angular/core';

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

/** Passed to every callback: `isLatest` is false for a call superseded by a more recent `mutate()`. */
export interface MutationCallbackContext {
  readonly isLatest: boolean;
}

/**
 * Callbacks run once for every call that settles, superseded or not, except calls aborted by
 * `reset()` or destroy. Only the latest call writes the signals.
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
  /** Unset: calls run in parallel. `'queue'`: one at a time, in order. `'drop'`: rejects a call made while one is pending. */
  concurrency?: 'queue' | 'drop';
  injector?: Injector;
}

export type MutationSnapshot<TOutput, TError = unknown> =
  | Readonly<{ status: 'idle'; value: undefined; error: undefined }>
  | Readonly<{ status: 'pending'; value: TOutput | undefined; error: undefined }>
  | Readonly<{ status: 'success'; value: TOutput; error: undefined }>
  | Readonly<{ status: 'error'; value: TOutput | undefined; error: TError }>;

export interface MutationRef<TInput, TOutput, TValue = TOutput | undefined, TError = unknown> {
  readonly status: Signal<MutationStatus>;
  /** Kept while a newer call is pending or after it fails: only a new success or `reset()` replaces it. */
  readonly value: Signal<TValue>;
  readonly error: Signal<TError | undefined>;
  readonly input: Signal<TInput | undefined>;
  readonly isPending: Signal<boolean>;
  readonly isIdle: Signal<boolean>;
  readonly isSuccess: Signal<boolean>;
  readonly isError: Signal<boolean>;
  readonly snapshot: Signal<MutationSnapshot<TOutput, TError>>;
  /** Always false for a `void` mutation: check `isSuccess()` instead. */
  hasValue(): this is MutationRef<TInput, TOutput, TOutput, TError>;
  /** Safe to ignore: a failure never reports an unhandled rejection. */
  mutate(input: TInput): Promise<TOutput>;
  /** Aborts in-flight calls, but never undoes a write the server already received. */
  reset(): void;
}

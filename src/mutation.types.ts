import type { Injector, Signal } from '@angular/core';

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

export interface MutationOptions<TInput, TOutput, TError = unknown> {
  mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>;
  onSuccess?: (output: TOutput, input: TInput) => void;
  onError?: (error: TError, input: TInput) => void;
  onSettled?: (output: TOutput | undefined, error: TError | undefined, input: TInput) => void;
  concurrency?: 'queue';
  injector?: Injector;
}

export type MutationSnapshot<TOutput, TError = unknown> =
  | Readonly<{ status: 'idle'; value: undefined; error: undefined }>
  | Readonly<{ status: 'pending'; value: TOutput | undefined; error: undefined }>
  | Readonly<{ status: 'success'; value: TOutput; error: undefined }>
  | Readonly<{ status: 'error'; value: TOutput | undefined; error: TError }>;

export interface MutationRef<TInput, TOutput, TValue = TOutput | undefined, TError = unknown> {
  readonly status: Signal<MutationStatus>;
  readonly value: Signal<TValue>;
  readonly error: Signal<TError | undefined>;
  readonly input: Signal<TInput | undefined>;
  readonly isPending: Signal<boolean>;
  readonly isIdle: Signal<boolean>;
  readonly isSuccess: Signal<boolean>;
  readonly isError: Signal<boolean>;
  readonly snapshot: Signal<MutationSnapshot<TOutput, TError>>;
  hasValue(): this is MutationRef<TInput, TOutput, TOutput, TError>;
  mutate(input: TInput): Promise<TOutput>;
  reset(): void;
}
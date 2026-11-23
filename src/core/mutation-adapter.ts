import type { MutationCallbackContext, MutationOptions } from './mutation.types.js';

/** What `createMutation()` needs from `mutation()` or an adapter. Not exported from any entry point. */
export interface MutationAdapter<TInput, TOutput, TExtra extends object> {
  createContext(): TExtra;
  run(input: TInput, call: AdapterCall<TExtra>): Promise<TOutput>;
  /** Runs when `reset()` is called, before it aborts the calls in flight. */
  onReset?(): void;
}

export interface AdapterCall<TExtra> {
  readonly abortSignal: AbortSignal;
  /** Added to the callbacks' context: fill it before the call settles. */
  readonly context: TExtra;
}

/** For an adapter that adds nothing to the callbacks' context. */
export type NoExtraContext = Record<never, never>;
export const noExtraContext = (): NoExtraContext => ({});

export type MutationAdapterOptions<TInput, TOutput, TError, TExtra extends object> = Omit<
  MutationOptions<TInput, TOutput, TError, MutationCallbackContext & TExtra>,
  'mutationFn'
>;

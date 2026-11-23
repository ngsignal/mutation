import type { MutationSnapshot } from './mutation.types.js';

/** One write per transition, so `status`, `value` and `error` can never disagree. */
export interface MutationState<TInput, TOutput, TError> {
  readonly snapshot: MutationSnapshot<TOutput, TError>;
  readonly input: TInput | undefined;
}

export const IDLE: MutationState<never, never, never> = {
  snapshot: { status: 'idle', value: undefined, error: undefined },
  input: undefined,
};

export function started<TInput, TOutput, TError>(
  { snapshot }: MutationState<TInput, TOutput, TError>,
  input: TInput,
): MutationState<TInput, TOutput, TError> {
  // Already pending: same snapshot, so a second call doesn't notify `snapshot()` readers.
  const pending = snapshot.status === 'pending' ? snapshot : { status: 'pending', value: snapshot.value, error: undefined } as const;
  return { snapshot: pending, input };
}

export function succeeded<TInput, TOutput, TError>(
  { input }: MutationState<TInput, TOutput, TError>,
  value: TOutput,
): MutationState<TInput, TOutput, TError> {
  return { snapshot: { status: 'success', value, error: undefined }, input };
}

export function failed<TInput, TOutput, TError>(
  { snapshot, input }: MutationState<TInput, TOutput, TError>,
  error: TError,
): MutationState<TInput, TOutput, TError> {
  return { snapshot: { status: 'error', value: snapshot.value, error }, input };
}

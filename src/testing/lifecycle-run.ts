import fc from 'fast-check';
import type { MutationOptions, MutationRef } from '../core/mutation.types';
import { createMutation, nextTask } from './mutation';

type Concurrency = 'parallel' | 'queue' | 'drop';

/** What a call does once it settles (from `onSettled`), and when its `AbortSignal` aborts. */
interface Reentry {
  readonly onSettled: 'none' | 'reset' | 'mutate';
  readonly onAbort: 'none' | 'mutate';
}

export type Step =
  | ({ type: 'mutate'; succeeds: boolean } & Reentry)
  | { type: 'reset' }
  | { type: 'settleOne' };

export interface Call extends Reentry {
  readonly id: number;
  readonly succeeds: boolean;
  /** False for a call `'drop'` rejected at once. */
  readonly admitted: boolean;
  settled: boolean;
  startedAt?: number;
  endedAt?: number;
  abortedAt?: number;
  /** The callbacks that ran for this call, in order. */
  readonly callbacks: ('onSuccess' | 'onError' | 'onSettled')[];
  /** Whether a callback of this call saw it in `pendingInputs()`. */
  listedInOwnCallback: boolean;
}

/** What `reset()` and `mutate()` were called with, in call order, reentrant calls included. */
type LogEntry = { type: 'mutate'; id: number } | { type: 'reset' };

export const concurrencyArb = fc.constantFrom<Concurrency>('parallel', 'queue', 'drop');

/** Calls (some reentrant), resets, and pauses that let one request finish, in a random order. */
export const stepsArb: fc.Arbitrary<Step[]> = fc.array(
  fc.oneof(
    {
      arbitrary: fc.record({
        type: fc.constant('mutate' as const),
        succeeds: fc.boolean(),
        onSettled: fc.constantFrom('none' as const, 'none' as const, 'reset' as const, 'mutate' as const),
        onAbort: fc.constantFrom('none' as const, 'none' as const, 'mutate' as const),
      }),
      weight: 4,
    },
    { arbitrary: fc.constant({ type: 'reset' as const }), weight: 1 },
    { arbitrary: fc.constant({ type: 'settleOne' as const }), weight: 3 },
  ),
  { minLength: 1, maxLength: 10 },
);

/** A call started from a callback or an abort listener: it succeeds and reenters no further. */
const reentrantCall = { succeeds: true, onSettled: 'none', onAbort: 'none' } as const;

/**
 * Plays steps on one mutation and records each call's lifecycle. `scheduler` decides when each
 * request finishes. The requests ignore their `AbortSignal`, the hardest case for the library.
 */
export function startLifecycleRun(scheduler: fc.Scheduler, concurrency: Concurrency) {
  const calls: Call[] = [];
  const outcomes: Promise<number>[] = [];
  const log: LogEntry[] = [];
  /** Indexes of the steps after which `status()` disagreed with the latest call. */
  const statusMismatches: number[] = [];
  let clock = 0;

  const mutationFn = async (call: Call, abortSignal: AbortSignal) => {
    call.startedAt = clock++;
    abortSignal.addEventListener('abort', () => {
      call.abortedAt = clock++;
      if (call.onAbort === 'mutate') mutate(reentrantCall);
    });
    await scheduler.schedule(Promise.resolve());
    call.endedAt = clock++;
    if (!call.succeeds) throw new Error(`failed ${call.id}`);
    return call.id;
  };

  const record = (call: Call, callback: Call['callbacks'][number]) => {
    call.callbacks.push(callback);
    call.listedInOwnCallback ||= mutationRef.pendingInputs().includes(call);
  };

  const options: MutationOptions<Call, number, Error> = {
    mutationFn,
    concurrency,
    onSuccess: (_output, call) => record(call, 'onSuccess'),
    onError: (_error, call) => record(call, 'onError'),
    onSettled: (_output, _error, call) => {
      record(call, 'onSettled');
      if (call.onSettled === 'reset') reset();
      if (call.onSettled === 'mutate') mutate(reentrantCall);
    },
  };
  const mutationRef: MutationRef<Call, number, Error> = createMutation(options);

  function mutate(spec: { succeeds: boolean } & Reentry): void {
    // `'drop'` locks from the call's start until it settles or aborts, as long as it is pending.
    const admitted = concurrency !== 'drop' || !mutationRef.isPending();
    const call: Call = { ...spec, id: calls.length, admitted, settled: false, callbacks: [], listedInOwnCallback: false };
    calls.push(call);
    log.push({ type: 'mutate', id: call.id });
    const outcome = mutationRef.mutate(call);
    outcomes.push(outcome);
    outcome.then(
      () => (call.settled = true),
      () => (call.settled = true),
    );
  }

  /** `status()` is `'pending'` exactly while the latest call admitted since the last `reset()` runs. */
  function checkStatus(stepIndex: number): void {
    const latest = latestAdmittedSinceReset(calls, log);
    const shouldBePending = latest !== undefined && !latest.settled;
    if ((mutationRef.status() === 'pending') !== shouldBePending) statusMismatches.push(stepIndex);
  }

  function reset(): void {
    log.push({ type: 'reset' });
    mutationRef.reset();
  }

  async function settleOne(): Promise<void> {
    if (scheduler.count() > 0) await scheduler.waitOne();
    await nextTask();
  }

  return {
    calls,
    log,
    mutationRef,
    statusMismatches,
    async play(steps: readonly Step[]): Promise<void> {
      for (const [index, step] of steps.entries()) {
        if (step.type === 'mutate') mutate(step);
        else if (step.type === 'reset') reset();
        else await settleOne();
        checkStatus(index);
      }
    },
    /** Lets every request finish, reentrant calls included, then returns how each call settled. */
    async settleAll(): Promise<PromiseSettledResult<number>[]> {
      let settledCount = -1;
      while (settledCount !== outcomes.length) {
        settledCount = outcomes.length;
        await scheduler.waitFor(Promise.allSettled([...outcomes]));
        await scheduler.waitIdle();
      }
      return Promise.allSettled(outcomes);
    },
  };
}

/** How a call settled: its value, or its error as `Name: message`. */
export function describeOutcome(result: PromiseSettledResult<number>): number | string {
  if (result.status === 'fulfilled') return result.value;
  const error = result.reason as Error;
  return `${error.name}: ${error.message}`;
}

const isCancelled = (outcome: number | string) => typeof outcome === 'string' && outcome.startsWith('AbortError: ');

/** Ids of the calls whose callbacks ran although cancelled, didn't run, ran twice, or out of order. */
export function wrongCallbacks(calls: readonly Call[], outcomes: readonly (number | string)[]): number[] {
  return calls
    .filter((call) => {
      const expected = isCancelled(outcomes[call.id]) ? [] : [call.succeeds ? 'onSuccess' : 'onError', 'onSettled'];
      return call.callbacks.join() !== expected.join();
    })
    .map((call) => call.id);
}

/** Ids of the calls whose callbacks saw them still in `pendingInputs()`. */
export function listedInOwnCallbacks(calls: readonly Call[]): number[] {
  return calls.filter((call) => call.listedInOwnCallback).map((call) => call.id);
}

/** Ids of the calls whose `AbortSignal` aborted after their `mutationFn` had settled. */
export function abortedAfterSettling(calls: readonly Call[]): number[] {
  return calls
    .filter((call) => call.abortedAt !== undefined && call.endedAt !== undefined && call.abortedAt > call.endedAt)
    .map((call) => call.id);
}

/** How a call that started should settle: `'Aborted'` once its signal aborted, else its own outcome. */
export function expectedOutcome(call: Call): number | string {
  if (call.startedAt === undefined) return 'never started';
  if (call.abortedAt !== undefined) return 'AbortError: Aborted';
  return call.succeeds ? call.id : `Error: failed ${call.id}`;
}

/** How a call that never started settled: always a cancellation. */
export function startedOrCancelled(call: Call, outcome: number | string): number | string {
  if (call.startedAt !== undefined) return outcome;
  return isCancelled(outcome) ? 'never started' : outcome;
}

/** The latest call admitted since the last `reset()`: the one the state signals follow. */
function latestAdmittedSinceReset(calls: readonly Call[], log: readonly LogEntry[]): Call | undefined {
  const lastReset = log.map((entry) => entry.type).lastIndexOf('reset');
  return log
    .slice(lastReset + 1)
    .flatMap((entry) => (entry.type === 'mutate' && calls[entry.id].admitted ? [calls[entry.id]] : []))
    .at(-1);
}

/** The state the mutation should end in: the outcome of the latest call admitted since the last `reset()`, or idle. */
export function expectedFinalState(calls: readonly Call[], log: readonly LogEntry[]) {
  const latest = latestAdmittedSinceReset(calls, log);
  if (!latest) return { status: 'idle', error: undefined, isPending: false };
  return latest.succeeds
    ? { status: 'success', error: undefined, isPending: false }
    : { status: 'error', error: `failed ${latest.id}`, isPending: false };
}

export function finalState(mutationRef: MutationRef<Call, number, Error>) {
  return { status: mutationRef.status(), error: mutationRef.error()?.message, isPending: mutationRef.isPending() };
}

/** Ids of the calls whose `'Dropped'` rejection disagrees with the model: keeps the model honest. */
export function droppedUnlikeModel(calls: readonly Call[], outcomes: readonly (number | string)[]): number[] {
  return calls.filter((call) => (outcomes[call.id] === 'AbortError: Dropped') === call.admitted).map((call) => call.id);
}

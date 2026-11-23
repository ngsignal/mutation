import fc from 'fast-check';
import { mutationQueue } from '../core/mutation-queue';
import type { MutationRef } from '../core/mutation.types';
import { createMutation, nextTask } from './mutation';

/** The three mutations sharing the queue: `save` and `archive` write one document, `removeAll` writes them all. */
export type Writer = 'save' | 'archive' | 'removeAll';
type DocId = 'A' | 'B';

export type Step =
  | { type: 'mutate'; writer: Writer; docId: DocId; succeeds: boolean }
  | { type: 'reset'; writer: Writer }
  | { type: 'settleOne' };

export interface Call {
  readonly id: number;
  readonly writer: Writer;
  readonly docId: DocId;
  readonly succeeds: boolean;
  startedAt?: number;
  endedAt?: number;
  abortedAs?: 'NotStarted' | 'Aborted';
}

const writerArb = fc.constantFrom<Writer>('save', 'archive', 'removeAll');

/** Calls, resets, and pauses that let one request finish, in a random order. */
export const stepsArb: fc.Arbitrary<Step[]> = fc.array(
  fc.oneof(
    {
      arbitrary: fc.record({
        type: fc.constant('mutate' as const),
        writer: writerArb,
        docId: fc.constantFrom<DocId>('A', 'B'),
        succeeds: fc.boolean(),
      }),
      weight: 4,
    },
    { arbitrary: fc.record({ type: fc.constant('reset' as const), writer: writerArb }), weight: 1 },
    { arbitrary: fc.constant({ type: 'settleOne' as const }), weight: 3 },
  ),
  { minLength: 1, maxLength: 12 },
);

/**
 * Plays steps on three mutations sharing one queue, and records when each call starts and ends.
 * `scheduler` decides when each request finishes. The requests ignore their `AbortSignal`, so a
 * call aborted in flight keeps holding the queue.
 */
export function startQueueRun(scheduler: fc.Scheduler) {
  const queue = mutationQueue();
  const calls: Call[] = [];
  const outcomes: Promise<number>[] = [];
  let clock = 0;

  const mutationFn = async (call: Call) => {
    call.startedAt = clock++;
    await scheduler.schedule(Promise.resolve());
    call.endedAt = clock++;
    if (!call.succeeds) throw new Error(`failed ${call.id}`);
    return call.id;
  };
  const perDocument = { queue, key: (call: Call) => call.docId };
  const mutations: Record<Writer, MutationRef<Call, number>> = {
    save: createMutation<Call, number>({ mutationFn, concurrency: perDocument }),
    archive: createMutation<Call, number>({ mutationFn, concurrency: perDocument }),
    removeAll: createMutation<Call, number>({ mutationFn, concurrency: queue }),
  };

  function mutate({ writer, docId, succeeds }: Extract<Step, { type: 'mutate' }>): void {
    const call: Call = { id: calls.length, writer, docId, succeeds };
    calls.push(call);
    outcomes.push(mutations[writer].mutate(call));
  }

  function reset(writer: Writer): void {
    for (const call of calls) {
      if (call.writer === writer && call.abortedAs === undefined && call.endedAt === undefined) {
        call.abortedAs = call.startedAt === undefined ? 'NotStarted' : 'Aborted';
      }
    }
    mutations[writer].reset();
  }

  async function settleOne(): Promise<void> {
    if (scheduler.count() > 0) await scheduler.waitOne();
    await nextTask();
  }

  return {
    calls,
    async play(steps: readonly Step[]): Promise<void> {
      for (const step of steps) {
        if (step.type === 'mutate') mutate(step);
        else if (step.type === 'reset') reset(step.writer);
        else await settleOne();
      }
    },
    /** Lets every request finish, then returns how each call settled. */
    async settleAll(): Promise<PromiseSettledResult<number>[]> {
      const results = await scheduler.waitFor(Promise.allSettled(outcomes));
      await scheduler.waitIdle();
      return results;
    },
  };
}

/** Two calls conflict when they write the same document, or one of them writes them all. */
function conflict(earlier: Call, later: Call): boolean {
  return earlier.writer === 'removeAll' || later.writer === 'removeAll' || earlier.docId === later.docId;
}

/** Conflicting calls that ran at the same time, or out of call order, as `[earlier, later]` ids. */
export function overlappingConflicts(calls: readonly Call[]): [number, number][] {
  return calls.flatMap((later) =>
    calls
      .slice(0, later.id)
      .filter((earlier) => conflict(earlier, later) && earlier.startedAt !== undefined && later.startedAt !== undefined)
      .filter((earlier) => (later.startedAt ?? 0) < (earlier.endedAt ?? Infinity))
      .map((earlier): [number, number] => [earlier.id, later.id]),
  );
}

/** Ids of the calls that started although reset while queued, or never started although they should have. */
export function wronglyStarted(calls: readonly Call[]): number[] {
  return calls.filter((call) => (call.startedAt === undefined) !== (call.abortedAs === 'NotStarted')).map((call) => call.id);
}

/** How a call settled: its value, or its error as `Name: message`. */
export function describeOutcome(result: PromiseSettledResult<number>): number | string {
  if (result.status === 'fulfilled') return result.value;
  const error = result.reason as Error;
  return `${error.name}: ${error.message}`;
}

/** How a call should settle, given whether and when it was reset. */
export function expectedOutcome(call: Call): number | string {
  if (call.abortedAs) return `AbortError: ${call.abortedAs}`;
  return call.succeeds ? call.id : `Error: failed ${call.id}`;
}

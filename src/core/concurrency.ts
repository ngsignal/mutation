import { neverSentError } from './abort-error.js';
import { createWriteQueue, writeQueueOf, type WriteQueue } from './mutation-queue.js';
import type { MutationOptions } from './mutation.types.js';

/** What a gate knows of a call: the queue key comes from its input. */
interface GateCall<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
  /** Aborts this call alone, before its `mutationFn` runs: `'queue-latest'` replacing it. */
  abort(reason: unknown): void;
}

/** A concurrency mode: it frees what it holds by itself, when the call settles or aborts. */
export interface ConcurrencyGate<TInput> {
  admit(): boolean;
  run<T>(task: () => Promise<T>, call: GateCall<TInput>): Promise<T>;
}

export function createConcurrencyGate<TInput>(
  concurrency: MutationOptions<TInput, unknown>['concurrency'],
): ConcurrencyGate<TInput> {
  switch (concurrency) {
    case 'queue':
      return createQueueGate(createWriteQueue(), noKey);
    case 'queue-latest':
      return createQueueLatestGate();
    case 'drop':
      return createDropGate();
    case 'parallel':
    case undefined:
      return { admit: () => true, run: (task) => task() };
    default:
      return 'key' in concurrency
        ? createQueueGate(writeQueueOf(concurrency.queue), concurrency.key)
        : createQueueGate(writeQueueOf(concurrency), noKey);
  }
}

function noKey(): undefined {
  return undefined;
}

function createQueueGate<TInput>(queue: WriteQueue, key: (input: TInput) => unknown): ConcurrencyGate<TInput> {
  return {
    admit: () => true,
    run: (task, { input, abortSignal }) => queue.run(key(input), task, abortSignal),
  };
}

/**
 * `'queue'` that keeps one waiting call at most: a call queued behind another replaces the call
 * waiting before it, which rejects at once with `'Replaced'` and never runs. A call queued behind
 * nothing runs, even if more calls follow in the same task: the head of the line is never replaced.
 */
function createQueueLatestGate<TInput>(): ConcurrencyGate<TInput> {
  const queue = createWriteQueue();
  let inLine = 0;
  let waiting: GateCall<TInput> | undefined;
  return {
    admit: () => true,
    run(task, call) {
      const leaveWaiting = () => {
        if (waiting === call) {
          waiting = undefined;
        }
      };
      if (inLine > 0) {
        waiting?.abort(neverSentError('Replaced'));
        waiting = call;
        // Aborted by reset() or destroy, it stops waiting: the gate must not keep its input.
        call.abortSignal.addEventListener('abort', leaveWaiting, { once: true });
      }
      inLine++;
      const turn = queue.run(undefined, () => {
        leaveWaiting();
        return task();
      }, call.abortSignal);
      // Registered before mutation() awaits the call: the line is shorter once its caller resumes.
      const leaveLine = () => {
        inLine--;
      };
      turn.then(leaveLine, leaveLine);
      return turn;
    },
  };
}

function createDropGate<TInput>(): ConcurrencyGate<TInput> {
  let locked = false;
  let holder: AbortSignal | undefined;
  return {
    admit() {
      if (locked) {
        return false;
      }
      locked = true;
      return true;
    },
    run(task, { abortSignal }) {
      holder = abortSignal;
      // An aborted call that settles later must not unlock a newer call: only the holder can.
      const unlock = () => {
        if (holder === abortSignal) {
          holder = undefined;
          locked = false;
        }
      };
      abortSignal.addEventListener('abort', unlock);
      return callAsPromise(task).finally(unlock);
    },
  };
}

function callAsPromise<T>(task: () => Promise<T>): Promise<T> {
  try {
    return task();
  } catch (error) {
    return Promise.reject(error);
  }
}

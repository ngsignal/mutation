import { neverSentError } from './abort-error.js';
import { createWriteQueue, writeQueueOf, type WriteQueue } from './mutation-queue.js';
import type { MutationOptions } from './mutation.types.js';

/** What a gate knows of a call: the queue key comes from its input. */
interface GateCall<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
  /** Aborts this call alone, before it runs. */
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
      if ('mode' in concurrency) {
        return createQueueLatestGate(concurrency.debounce);
      }
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

/** `'queue-latest'` and `{ mode: 'queue-latest', debounce }`: a queue of its own with a single waiting slot. */
function createQueueLatestGate<TInput>(debounce = 0): ConcurrencyGate<TInput> {
  // A NaN or negative delay would silently mean no debounce: fail where the mutation is created.
  if (!(Number.isFinite(debounce) && debounce >= 0)) {
    throw new RangeError(`debounce must be a finite number of milliseconds >= 0, got ${debounce}`);
  }
  return singleWaitingSlot(createQueueGate(createWriteQueue(), noKey), debounce);
}

/**
 * Decorates a gate with a single waiting slot. A call that would wait takes the slot and replaces
 * the call holding it, which rejects with `'Replaced'` and never runs; a call leaves the slot once
 * sent, so the head of the line is never replaced.
 *
 * With a `debounce`, every call also waits that long after `mutate()`, the first one too: it holds
 * the slot during its delay even when nothing is in flight, so a newer call can replace it. The
 * delay and the slot can't be split into two decorators: the delay decides how long a call waits.
 */
function singleWaitingSlot<TInput>(gate: ConcurrencyGate<TInput>, debounce: number): ConcurrencyGate<TInput> {
  let inLine = 0;
  let waiting: GateCall<TInput> | undefined;
  return {
    admit: gate.admit,
    run(task, call) {
      const stopWaiting = () => {
        if (waiting === call) {
          waiting = undefined;
        }
      };
      if (inLine > 0 || debounce > 0) {
        waiting?.abort(neverSentError('Replaced'));
        waiting = call;
        // A call aborted by reset() or destroy stops waiting: don't keep its input.
        call.abortSignal.addEventListener('abort', stopWaiting, { once: true });
      }
      inLine++;
      const send = () => {
        stopWaiting();
        return task();
      };
      // Started here, at mutate(), so the delay overlaps the call in flight.
      const turn = gate.run(debounce > 0 ? startDelay(debounce, call.abortSignal, send) : send, call);
      // Registered before mutation() awaits `turn`, so the line is shorter when its caller resumes.
      const leaveLine = () => {
        inLine--;
      };
      turn.then(leaveLine, leaveLine);
      return turn;
    },
  };
}

/**
 * Starts a `ms` timer now, not when the returned task runs; the task waits for it, then runs `task`.
 * An abort clears the timer, so a queue never waits for an aborted call's delay.
 */
function startDelay<T>(ms: number, abortSignal: AbortSignal, task: () => Promise<T>): () => Promise<T> {
  const elapsed = new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    abortSignal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', done);
      resolve();
    }
  });
  // Checked after the timer: a call aborted during its delay, or replaced right after it, is never sent.
  return () => elapsed.then(() => (abortSignal.aborted ? Promise.reject(abortSignal.reason) : task()));
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

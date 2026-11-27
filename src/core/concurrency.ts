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
      return replaceWaitingCall(createQueueGate(createWriteQueue(), noKey));
    case 'drop':
      return createDropGate();
    case 'parallel':
    case undefined:
      return { admit: () => true, run: (task) => task() };
    default:
      if ('mode' in concurrency) {
        return replaceWaitingCall(createQueueGate(createWriteQueue(), noKey), concurrency.debounce);
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

/**
 * Decorates a gate with a single line: a call that would wait replaces the call already waiting,
 * which rejects with `'Replaced'` and never runs. The head of the line is never replaced once
 * sent. With a `debounce`, every call waits that long after `mutate()`, so the first one too.
 */
function replaceWaitingCall<TInput>(gate: ConcurrencyGate<TInput>, debounce = 0): ConcurrencyGate<TInput> {
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
      const turn = gate.run(debounce > 0 ? afterDelay(debounce, call.abortSignal, send) : send, call);
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
 * Starts a `ms` timer now. The returned task waits for it, then runs `task`, unless `abortSignal`
 * aborted meanwhile: an abort clears the timer and rejects at once, so a queue never waits for it.
 */
function afterDelay<T>(ms: number, abortSignal: AbortSignal, task: () => Promise<T>): () => Promise<T> {
  const elapsed = new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    abortSignal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', done);
      resolve();
    }
  });
  // Checked after the timer too: a call replaced right after its delay elapsed is never sent.
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

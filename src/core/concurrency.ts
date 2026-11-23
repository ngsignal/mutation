import { createWriteQueue, writeQueueOf, type WriteQueue } from './mutation-queue.js';
import type { MutationOptions } from './mutation.types.js';

/** What a gate knows of a call: the queue key comes from its input. */
export interface GateCall<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
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

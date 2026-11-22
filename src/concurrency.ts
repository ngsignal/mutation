import { abortError } from './abort-error.js';
import type { MutationOptions } from './mutation.types.js';

/** A concurrency mode: it frees what it holds by itself, when the call settles or aborts. */
export interface ConcurrencyGate {
  admit(): boolean;
  run<T>(task: () => Promise<T>, abortSignal: AbortSignal): Promise<T>;
}

export function createConcurrencyGate(concurrency: MutationOptions<unknown, unknown>['concurrency']): ConcurrencyGate {
  switch (concurrency) {
    case 'queue':
      return createQueueGate();
    case 'drop':
      return createDropGate();
    case 'parallel':
    case undefined:
      return { admit: () => true, run: (task) => task() };
  }
}

function createQueueGate(): ConcurrencyGate {
  let previousCall: Promise<unknown> = Promise.resolve();
  return {
    admit: () => true,
    run<T>(task: () => Promise<T>, abortSignal: AbortSignal) {
      return new Promise<T>((resolve, reject) => {
        // Aborted while waiting: reject now rather than when its turn comes.
        const leaveQueue = () => reject(abortError('NotStarted'));
        abortSignal.addEventListener('abort', leaveQueue, { once: true });

        const call = previousCall.then(() => {
          abortSignal.removeEventListener('abort', leaveQueue);
          return abortSignal.aborted ? Promise.reject(abortError('NotStarted')) : task();
        });
        // The next call waits for this one even if it left the queue: writes stay in order.
        previousCall = call.catch(() => undefined);
        call.then(resolve, reject);
      });
    },
  };
}

function createDropGate(): ConcurrencyGate {
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
    run(task, abortSignal) {
      holder = abortSignal;
      // An aborted call that settles later must not unlock a newer call: only the holder can.
      const unlock = () => {
        abortSignal.removeEventListener('abort', unlock);
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

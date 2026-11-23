import { abortError } from './abort-error.js';
import type { MutationQueue } from './mutation.types.js';

/** What a `MutationQueue` is at runtime. Not exported from any entry point. */
export interface WriteQueue {
  /** The last call queued under each key, removed once it settles: a key never outlives its calls. */
  readonly tails: ReadonlyMap<unknown, Promise<unknown>>;
  /** Runs `task` once every call queued before it under `key` has settled. */
  run<T>(key: unknown, task: () => Promise<T>, abortSignal: AbortSignal): Promise<T>;
}

/**
 * Creates a write queue to share between mutations: pass it as their `concurrency`, and their calls
 * run one at a time, in call order, whichever mutation makes them. Each mutation keeps its own
 * signals. Use `{ queue, key }` to queue per key instead, e.g. per entity id.
 *
 * Create it in a service: a queue at module level would be shared by every SSR request.
 *
 * @example
 * ```ts
 * @Injectable({ providedIn: 'root' })
 * export class TodoWrites {
 *   readonly queue = mutationQueue();
 * }
 *
 * readonly rename = httpMutation<Todo, Todo>({ request: …, concurrency: inject(TodoWrites).queue });
 * readonly remove = httpMutation<string, void>({ request: …, concurrency: inject(TodoWrites).queue });
 * ```
 *
 * @see https://github.com/ngsignal/mutation/blob/main/docs/RECIPES.md#ordering-writes-across-mutations
 */
export function mutationQueue(): MutationQueue {
  return createWriteQueue() as unknown as MutationQueue;
}

/** The runtime object behind a `MutationQueue`, which is opaque to callers. */
export function writeQueueOf(queue: MutationQueue): WriteQueue {
  return queue as unknown as WriteQueue;
}

export function createWriteQueue(): WriteQueue {
  const tails = new Map<unknown, Promise<unknown>>();
  return {
    tails,
    run<T>(key: unknown, task: () => Promise<T>, abortSignal: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        // Aborted while waiting: reject now rather than when its turn comes.
        const leaveQueue = () => reject(abortError('NotStarted'));
        abortSignal.addEventListener('abort', leaveQueue, { once: true });

        const call = (tails.get(key) ?? Promise.resolve()).then(() => {
          abortSignal.removeEventListener('abort', leaveQueue);
          return abortSignal.aborted ? Promise.reject(abortError('NotStarted')) : task();
        });
        // The next call waits for this one even if it left the queue: writes stay in order.
        const tail = call.catch(() => undefined);
        tails.set(key, tail);
        void tail.then(() => {
          if (tails.get(key) === tail) {
            tails.delete(key);
          }
        });
        call.then(resolve, reject);
      });
    },
  };
}

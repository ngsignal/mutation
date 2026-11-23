import { PendingTasks } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { mutation } from '../core/mutation';

/** Spies on PendingTasks.add() so each returned cleanup fn can be asserted on individually. */
export function spyOnPendingTasks(): Mock<() => void>[] {
  const pendingTasks = TestBed.inject(PendingTasks);
  const originalAdd = pendingTasks.add.bind(pendingTasks);
  const removeFns: Mock<() => void>[] = [];

  vi.spyOn(pendingTasks, 'add').mockImplementation(() => {
    const spy = vi.fn(originalAdd());
    removeFns.push(spy);
    return spy;
  });
  return removeFns;
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createMutation<TInput, TOutput, TError = unknown>(
  options: Parameters<typeof mutation<TInput, TOutput, TError>>[0],
) {
  return TestBed.runInInjectionContext(() => mutation<TInput, TOutput, TError>(options));
}

/**
 * A mutationFn that resolves/rejects like `deferredCalls[0]` on the first mutate() call,
 * then `deferredCalls[1]`, and so on.
 */
export function sequencedMutationFn<T>(
  ...deferredCalls: Array<{ promise: Promise<T> }>
): () => Promise<T> {
  let callIndex = 0;
  return () => deferredCalls[callIndex++].promise;
}

/** Waits for the next macrotask, e.g. for a `mutationFn` settled after its call was aborted. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** What `promise` settled with by the next macrotask, or `'pending'`: checks that a call settles at once. */
export function outcomeAfterATask(promise: Promise<unknown>): Promise<{ resolved: unknown } | { rejected: unknown } | 'pending'> {
  return Promise.race([
    promise.then((resolved) => ({ resolved }), (rejected: unknown) => ({ rejected })),
    nextTask().then(() => 'pending' as const),
  ]);
}

/** Lets a `'queue'` mutation start the mutationFn of the call at its head, a microtask after `mutate()`. */
export function queueTurn(): Promise<void> {
  return Promise.resolve();
}

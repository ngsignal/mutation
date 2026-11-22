import { PendingTasks } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { mutation } from '../mutation';

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

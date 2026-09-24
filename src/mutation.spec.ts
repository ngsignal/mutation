import {
  provideZonelessChangeDetection,
  EnvironmentInjector,
  createEnvironmentInjector,
  PendingTasks,
  ApplicationRef,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectTypeOf } from 'vitest';
import { mutation } from './mutation';

/** Spies on PendingTasks.add() so each returned cleanup fn can be asserted on individually. */
function spyOnPendingTasks() {
  const pendingTasks = TestBed.inject(PendingTasks);
  const originalAdd = pendingTasks.add.bind(pendingTasks);
  const removeFns: ReturnType<typeof vi.fn>[] = [];

  vi.spyOn(pendingTasks, 'add').mockImplementation(() => {
    const spy = vi.fn(originalAdd());
    removeFns.push(spy);
    return spy;
  });
  return removeFns;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMutation<TInput, TOutput, TError = unknown>(
  options: Parameters<typeof mutation<TInput, TOutput, TError>>[0],
) {
  return TestBed.runInInjectionContext(() => mutation<TInput, TOutput, TError>(options));
}

/**
 * A mutationFn that resolves/rejects like `deferredCalls[0]` on the first mutate() call,
 * then `deferredCalls[1]`, and so on.
 */
function sequencedMutationFn<T>(
  ...deferredCalls: Array<{ promise: Promise<T> }>
): () => Promise<T> {
  let callIndex = 0;
  return () => deferredCalls[callIndex++].promise;
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
});

describe('lifecycle', () => {
  it('goes through pending then success with the returned value', async () => {
    const deferred = createDeferred<string>();
    const m = createMutation<void, string>({ mutationFn: () => deferred.promise });

    expect(m.status()).toBe('idle');
    expect(m.isIdle()).toBe(true);

    const call = m.mutate();
    expect(m.status()).toBe('pending');
    expect(m.isPending()).toBe(true);
    expect(m.isIdle()).toBe(false);
    expect(m.isSuccess()).toBe(false);
    expect(m.isError()).toBe(false);

    deferred.resolve('ok');
    await call;

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('ok');
    expect(m.isPending()).toBe(false);
    expect(m.isSuccess()).toBe(true);
    expect(m.isError()).toBe(false);
  });

  it('calls onSuccess with the output and input after a success', async () => {
    const onSuccess = vi.fn();
    const m = createMutation<string, string>({
      mutationFn: (input) => Promise.resolve(`${input}-done`),
      onSuccess,
    });

    await m.mutate('task');

    expect(onSuccess).toHaveBeenCalledWith('task-done', 'task');
  });

  it('goes into error state if mutationFn rejects', async () => {
    const deferred = createDeferred<string>();
    const m = createMutation<void, string>({ mutationFn: () => deferred.promise });

    const call = m.mutate().catch(() => undefined);
    deferred.reject(new Error('boom'));
    await call;

    expect(m.status()).toBe('error');
    expect((m.error() as Error).message).toBe('boom');
    expect(m.isError()).toBe(true);
    expect(m.isSuccess()).toBe(false);
  });

  it('calls onError with the error and input after a rejection', async () => {
    const onError = vi.fn();
    const failure = new Error('boom');
    const m = createMutation<string, string>({
      mutationFn: () => Promise.reject(failure),
      onError,
    });

    await m.mutate('task').catch(() => undefined);

    expect(onError).toHaveBeenCalledWith(failure, 'task');
  });

  it('types error() and onError() as TError instead of unknown', () => {
    const m = createMutation<string, string, Error>({
      mutationFn: (input) => Promise.resolve(input),
      onError: (err) => expectTypeOf(err).toEqualTypeOf<Error>(),
    });

    expectTypeOf(m.error).returns.toEqualTypeOf<Error | undefined>();
  });

  it('calls onSettled with the output after a success, once onSuccess has run', async () => {
    const calls: string[] = [];
    const onSettled = vi.fn((..._args) => calls.push('onSettled'));
    const onSuccess = vi.fn(() => calls.push('onSuccess'));
    const m = createMutation<string, string>({
      mutationFn: (input) => Promise.resolve(`${input}-done`),
      onSuccess,
      onSettled,
    });

    await m.mutate('task');

    expect(onSettled).toHaveBeenCalledWith('task-done', undefined, 'task');
    expect(calls).toEqual(['onSuccess', 'onSettled']);
  });

  it('calls onSettled with the error after a rejection, once onError has run', async () => {
    const calls: string[] = [];
    const failure = new Error('boom');
    const onSettled = vi.fn((..._args) => calls.push('onSettled'));
    const onError = vi.fn(() => calls.push('onError'));
    const m = createMutation<string, string>({
      mutationFn: () => Promise.reject(failure),
      onError,
      onSettled,
    });

    await m.mutate('task').catch(() => undefined);

    expect(onSettled).toHaveBeenCalledWith(undefined, failure, 'task');
    expect(calls).toEqual(['onError', 'onSettled']);
  });
});

describe('input', () => {
  it('is undefined before the first mutate() call', () => {
    const m = createMutation<string, string>({ mutationFn: (input) => Promise.resolve(input) });

    expect(m.input()).toBeUndefined();
  });

  it('reflects the submitted input while pending and after settling', async () => {
    const deferred = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: () => deferred.promise });

    const call = m.mutate('task');
    expect(m.input()).toBe('task');

    deferred.resolve('done');
    await call;
    expect(m.input()).toBe('task');
  });

  it('resets to undefined after reset()', async () => {
    const m = createMutation<string, string>({ mutationFn: (input) => Promise.resolve(input) });

    await m.mutate('task');
    expect(m.input()).toBe('task');

    m.reset();
    expect(m.input()).toBeUndefined();
  });
});

describe('concurrent mutate() calls', () => {
  it('keeps the previous value when a later mutation fails', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();

    const m = createMutation<void, string>({ mutationFn: sequencedMutationFn(first, second) });

    first.resolve('ok');
    await m.mutate();
    expect(m.value()).toBe('ok');

    const call = m.mutate().catch(() => undefined);
    second.reject(new Error('boom'));
    await call;

    expect(m.status()).toBe('error');
    expect(m.value()).toBe('ok');
  });

  it('ignores the response of a stale call when a more recent mutation has started', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();

    const m = createMutation<void, string>({ mutationFn: sequencedMutationFn(first, second) });

    const firstCall = m.mutate();
    const secondCall = m.mutate();

    second.resolve('second');
    await secondCall;
    expect(m.status()).toBe('success');
    expect(m.value()).toBe('second');

    first.resolve('first');
    await firstCall;
    expect(m.value()).toBe('second');
    expect(m.status()).toBe('success');
  });

  it('ignores the rejection of a stale call when a more recent mutation has already succeeded', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const onError = vi.fn();

    const m = createMutation<void, string>({
      mutationFn: sequencedMutationFn(first, second),
      onError,
    });

    const firstCall = m.mutate();
    const secondCall = m.mutate();

    second.resolve('second');
    await secondCall;
    expect(m.status()).toBe('success');
    expect(m.value()).toBe('second');

    first.reject(new Error('too late'));
    await expect(firstCall).rejects.toThrow('too late');

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('second');
    expect(m.error()).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects a superseded call with its own real error, even though the signals ignore it', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const onError = vi.fn();

    const m = createMutation<void, string>({
      mutationFn: sequencedMutationFn(first, second),
      onError,
    });

    const firstCall = m.mutate();
    const secondCall = m.mutate();

    first.reject(new DOMException('Aborted', 'AbortError'));
    await expect(firstCall).rejects.toMatchObject({ name: 'AbortError' });

    second.resolve('second');
    await secondCall;

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('second');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reflects the most recently submitted input as soon as mutate() is called', () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();

    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second) });

    m.mutate('first');
    expect(m.input()).toBe('first');

    m.mutate('second');
    expect(m.input()).toBe('second');
  });

  it('does not call onSettled for a stale call superseded by a more recent mutation', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const onSettled = vi.fn();

    const m = createMutation<void, string>({
      mutationFn: sequencedMutationFn(first, second),
      onSettled,
    });

    const firstCall = m.mutate();
    const secondCall = m.mutate();

    second.resolve('second');
    await secondCall;
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('second', undefined, undefined);

    first.resolve('first');
    await firstCall;
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('does not abort a previous mutation when a new one starts', () => {
    const abortSignals: AbortSignal[] = [];
    const m = createMutation<void, void>({
      mutationFn: (_input, signal) => {
        abortSignals.push(signal);
        return new Promise<void>(() => {});
      },
    });

    m.mutate();
    expect(abortSignals[0].aborted).toBe(false);

    m.mutate();
    expect(abortSignals[0].aborted).toBe(false);
    expect(abortSignals[1].aborted).toBe(false);
  });
});

describe("concurrency: 'queue'", () => {
  it('does not start the next mutationFn call until the previous one has settled', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const started: string[] = [];

    const m = createMutation<string, string>({
      concurrency: 'queue',
      mutationFn: (input) => {
        started.push(input);
        return input === 'first' ? first.promise : second.promise;
      },
    });

    const firstCall = m.mutate('first');
    const secondCall = m.mutate('second');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['first']);

    first.resolve('first-done');
    await firstCall;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['first', 'second']);

    second.resolve('second-done');
    await secondCall;
  });

  it('still only commits the most recently submitted call, deterministically', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const onSuccess = vi.fn();

    const m = createMutation<void, string>({
      concurrency: 'queue',
      mutationFn: sequencedMutationFn(first, second),
      onSuccess,
    });

    const firstCall = m.mutate();
    const secondCall = m.mutate();

    // Resolved out of submission order on purpose: queueing still guarantees mutationFn for
    // 'second' only runs after 'first' has settled, so this can't make 'first' win.
    second.resolve('second-done');
    first.resolve('first-done');
    await firstCall;
    await secondCall;

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('second-done');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('second-done', undefined);
  });

  it('skips mutationFn for a call that is still queued when reset() runs', async () => {
    const first = createDeferred<string>();
    const started: string[] = [];

    const m = createMutation<string, string>({
      concurrency: 'queue',
      mutationFn: (input) => {
        started.push(input);
        return input === 'first' ? first.promise : Promise.resolve('unused');
      },
    });

    const firstCall = m.mutate('first').catch(() => undefined);
    const secondCall = m.mutate('second').catch(() => undefined);

    // Let the queue actually start the first call's mutationFn before resetting.
    await Promise.resolve();
    expect(started).toEqual(['first']);

    m.reset();

    first.resolve('first-done');
    await firstCall;
    await secondCall;

    expect(started).toEqual(['first']);
  });

  it('does not block calls queued after one that fails', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const third = createDeferred<string>();

    const m = createMutation<void, string>({
      concurrency: 'queue',
      mutationFn: sequencedMutationFn(first, second, third),
    });

    const firstCall = m.mutate().catch(() => undefined);
    const secondCall = m.mutate().catch(() => undefined);
    const thirdCall = m.mutate();

    first.reject(new Error('first failed'));
    await firstCall;

    second.reject(new Error('second failed'));
    await secondCall;

    third.resolve('third-done');
    await thirdCall;

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('third-done');
  });

  it('releases the pending task of a still-queued call immediately when reset() runs, without calling its mutationFn', async () => {
    const removeFns = spyOnPendingTasks();
    const first = createDeferred<string>();
    const started: string[] = [];

    const m = createMutation<string, string>({
      concurrency: 'queue',
      mutationFn: (input) => {
        started.push(input);
        return input === 'first' ? first.promise : Promise.resolve('unused');
      },
    });

    const firstCall = m.mutate('first');
    const secondCall = m.mutate('second').catch(() => undefined);

    // Let the queue actually start the first call's mutationFn before resetting.
    await Promise.resolve();
    expect(started).toEqual(['first']);
    expect(removeFns[1]).not.toHaveBeenCalled();

    m.reset();
    expect(removeFns[1]).toHaveBeenCalledTimes(1);

    first.resolve('first-done');
    await firstCall;
    await secondCall;

    expect(started).toEqual(['first']);
  });

  it('does not call mutationFn for a call still queued when the injector is destroyed', async () => {
    const first = createDeferred<string>();
    const started: string[] = [];
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);

    const m = mutation<string, string>({
      concurrency: 'queue',
      mutationFn: (input) => {
        started.push(input);
        return input === 'first' ? first.promise : Promise.resolve('unused');
      },
      injector: childInjector,
    });

    m.mutate('first');
    const secondCall = m.mutate('second').catch(() => undefined);

    // Let the queue actually start the first call's mutationFn before destroying.
    await Promise.resolve();
    expect(started).toEqual(['first']);

    childInjector.destroy();

    first.resolve('first-done');
    await secondCall;

    expect(started).toEqual(['first']);
  });
});

describe('returned promise', () => {
  it('does not report an unhandled rejection when the caller ignores it', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const m = createMutation<void, string>({ mutationFn: () => Promise.reject(new Error('boom')) });

      m.mutate();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(m.status()).toBe('error');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('still rejects with the original error for a caller that awaits it', async () => {
    const failure = new Error('boom');
    const m = createMutation<void, string>({ mutationFn: () => Promise.reject(failure) });

    await expect(m.mutate()).rejects.toBe(failure);
  });
});

describe("concurrency: 'drop'", () => {
  it('drops mutate() calls made while one is in flight, rejecting them with an AbortError', async () => {
    const first = createDeferred<string>();
    const started: string[] = [];
    const onSuccess = vi.fn();

    const m = createMutation<string, string>({
      concurrency: 'drop',
      mutationFn: (input) => {
        started.push(input);
        return first.promise;
      },
      onSuccess,
    });

    const firstCall = m.mutate('first');
    const droppedCall = m.mutate('second');

    await expect(droppedCall).rejects.toMatchObject({ name: 'AbortError', message: 'Dropped' });
    expect(started).toEqual(['first']);
    expect(m.status()).toBe('pending');
    expect(m.input()).toBe('first');

    first.resolve('first-done');
    await expect(firstCall).resolves.toBe('first-done');

    expect(m.value()).toBe('first-done');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('first-done', 'first');
  });

  it('does not report an unhandled rejection for a dropped call the caller ignores', async () => {
    const first = createDeferred<string>();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const m = createMutation<void, string>({
        concurrency: 'drop',
        mutationFn: () => first.promise,
      });

      m.mutate();
      m.mutate();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
      first.resolve('done');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does not register a pending task for a dropped call', async () => {
    const removeFns = spyOnPendingTasks();
    const first = createDeferred<string>();

    const m = createMutation<void, string>({
      concurrency: 'drop',
      mutationFn: () => first.promise,
    });

    const firstCall = m.mutate();
    await m.mutate().catch(() => undefined);
    expect(removeFns).toHaveLength(1);

    first.resolve('done');
    await firstCall;
    expect(removeFns[0]).toHaveBeenCalledTimes(1);
  });

  it('accepts a new call once the previous one has failed', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();

    const m = createMutation<void, string>({
      concurrency: 'drop',
      mutationFn: sequencedMutationFn(first, second),
    });

    const firstCall = m.mutate();
    first.reject(new Error('first failed'));
    await expect(firstCall).rejects.toThrow('first failed');

    const secondCall = m.mutate();
    second.resolve('second-done');
    await expect(secondCall).resolves.toBe('second-done');
    expect(m.status()).toBe('success');
  });

  it('accepts a new call from onSuccess, once the previous one has committed', async () => {
    const started: string[] = [];
    let chained: Promise<string> | undefined;

    const m = createMutation<string, string>({
      concurrency: 'drop',
      mutationFn: (input) => {
        started.push(input);
        return Promise.resolve(`${input}-done`);
      },
      onSuccess: (_output, input) => {
        if (input === 'first') {
          chained = m.mutate('second');
        }
      },
    });

    await m.mutate('first');
    await chained;

    expect(started).toEqual(['first', 'second']);
    expect(m.value()).toBe('second-done');
  });

  it('accepts a new call right after reset() aborts the in-flight one', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const started: string[] = [];

    const m = createMutation<string, string>({
      concurrency: 'drop',
      mutationFn: (input) => {
        started.push(input);
        return input === 'first' ? first.promise : second.promise;
      },
    });

    const firstCall = m.mutate('first');
    m.reset();
    const secondCall = m.mutate('second');

    expect(started).toEqual(['first', 'second']);

    first.resolve('first-done');
    await firstCall;
    expect(m.status()).toBe('pending');

    // 'first' settling must not release the lock now held by 'second'.
    await expect(m.mutate('third')).rejects.toMatchObject({ name: 'AbortError', message: 'Dropped' });

    second.resolve('second-done');
    await secondCall;
    expect(m.value()).toBe('second-done');
    expect(started).toEqual(['first', 'second']);
  });
});

describe('reset()', () => {
  it('resets status/value/error to their initial state', async () => {
    const m = createMutation<void, string>({ mutationFn: () => Promise.resolve('ok') });

    await m.mutate();
    expect(m.status()).toBe('success');

    m.reset();
    expect(m.status()).toBe('idle');
    expect(m.value()).toBeUndefined();
    expect(m.error()).toBeUndefined();
  });

  it('ignores the result of a mutation that was still in flight', async () => {
    const deferred = createDeferred<string>();
    let abortSignal!: AbortSignal;
    const m = createMutation<void, string>({
      mutationFn: (_input, signal) => {
        abortSignal = signal;
        return deferred.promise;
      },
    });

    const call = m.mutate();
    expect(m.status()).toBe('pending');

    m.reset();
    expect(abortSignal.aborted).toBe(true);
    expect(m.status()).toBe('idle');

    deferred.resolve('too late');
    await call;

    expect(m.status()).toBe('idle');
    expect(m.value()).toBeUndefined();
  });
});

describe('hasValue()', () => {
  it('reflects whether value() is set', async () => {
    const m = createMutation<void, string>({ mutationFn: () => Promise.resolve('ok') });

    expect(m.hasValue()).toBe(false);

    await m.mutate();

    expect(m.hasValue()).toBe(true);
    expect(m.value()).toBe('ok');
  });

  it('types value() as TOutput once hasValue() narrows it', () => {
    const m = createMutation<void, string>({ mutationFn: () => Promise.resolve('ok') });

    expectTypeOf(m.value()).toEqualTypeOf<string | undefined>();

    if (m.hasValue()) {
      expectTypeOf(m.value()).toEqualTypeOf<string>();
    }
  });

  it('keeps TError typed on error() after hasValue() narrows the ref', () => {
    const m = createMutation<string, string, Error>({
      mutationFn: (input) => Promise.resolve(input),
    });

    if (m.hasValue()) {
      expectTypeOf(m.error).returns.toEqualTypeOf<Error | undefined>();
    }
  });
});

describe('snapshot()', () => {
  it('reflects idle, pending, success and error with the right shape', async () => {
    const deferred = createDeferred<string>();
    const m = createMutation<void, string>({ mutationFn: () => deferred.promise });

    expect(m.snapshot()).toEqual({ status: 'idle', value: undefined, error: undefined });

    const call = m.mutate();
    expect(m.snapshot()).toEqual({ status: 'pending', value: undefined, error: undefined });

    deferred.resolve('ok');
    await call;
    expect(m.snapshot()).toEqual({ status: 'success', value: 'ok', error: undefined });
  });

  it('keeps the last known value alongside the error on failure', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const failure = new Error('boom');

    const m = createMutation<void, string>({ mutationFn: sequencedMutationFn(first, second) });

    first.resolve('ok');
    await m.mutate();

    const call = m.mutate().catch(() => undefined);
    second.reject(failure);
    await call;

    expect(m.snapshot()).toEqual({ status: 'error', value: 'ok', error: failure });
  });

  it('is typed as a discriminated union narrowed by status', () => {
    const m = createMutation<void, string>({ mutationFn: () => Promise.resolve('ok') });

    const snap = m.snapshot();
    if (snap.status === 'success') {
      expectTypeOf(snap.value).toEqualTypeOf<string>();
    } else if (snap.status === 'error') {
      expectTypeOf(snap.value).toEqualTypeOf<string | undefined>();
      expectTypeOf(snap.error).toEqualTypeOf<unknown>();
    } else {
      expectTypeOf(snap.value).toEqualTypeOf<string | undefined>();
    }
  });

  it('types .error as TError instead of unknown', () => {
    const m = createMutation<string, string, Error>({
      mutationFn: (input) => Promise.resolve(input),
    });

    const snap = m.snapshot();
    if (snap.status === 'error') {
      expectTypeOf(snap.error).toEqualTypeOf<Error>();
    }
  });
});

describe('pending tasks', () => {
  it('keeps the pending task of a superseded call open until its own mutationFn settles', async () => {
    const removeFns = spyOnPendingTasks();

    const first = createDeferred<string>();
    const second = createDeferred<string>();

    const m = createMutation<void, string>({ mutationFn: sequencedMutationFn(first, second) });

    const firstCall = m.mutate();
    expect(removeFns[0]).not.toHaveBeenCalled();

    const secondCall = m.mutate();

    expect(removeFns[0]).not.toHaveBeenCalled();
    expect(removeFns[1]).not.toHaveBeenCalled();

    second.resolve('done');
    await secondCall;
    expect(removeFns[1]).toHaveBeenCalledTimes(1);
    expect(removeFns[0]).not.toHaveBeenCalled();

    first.resolve('too late');
    await firstCall;
    expect(removeFns[0]).toHaveBeenCalledTimes(1);
  });

  it('releases the pending task immediately when reset() is called mid-flight', async () => {
    const removeFns = spyOnPendingTasks();

    const deferred = createDeferred<string>();
    const m = createMutation<void, string>({ mutationFn: () => deferred.promise });

    const call = m.mutate();
    expect(removeFns[0]).not.toHaveBeenCalled();

    m.reset();
    expect(removeFns[0]).toHaveBeenCalledTimes(1);

    deferred.resolve('too late');
    await call;

    expect(removeFns[0]).toHaveBeenCalledTimes(2);
  });

  it('does not release the pending task or abort the controller again when reset() follows a settled mutation', async () => {
    const removeFns = spyOnPendingTasks();

    let abortSignal!: AbortSignal;
    const m = createMutation<void, string>({
      mutationFn: (_input, signal) => {
        abortSignal = signal;
        return Promise.resolve('ok');
      },
    });

    await m.mutate();
    expect(removeFns[0]).toHaveBeenCalledTimes(1);
    expect(abortSignal.aborted).toBe(false);

    m.reset();
    expect(removeFns[0]).toHaveBeenCalledTimes(1);
    expect(abortSignal.aborted).toBe(false);
  });

  it('keeps ApplicationRef unstable while a mutation is in flight, for SSR/zoneless stability', async () => {
    const applicationRef = TestBed.inject(ApplicationRef);
    const deferred = createDeferred<string>();
    const m = createMutation<void, string>({ mutationFn: () => deferred.promise });

    m.mutate();

    let stable = false;
    applicationRef.whenStable().then(() => {
      stable = true;
    });

    // Flush a macrotask so any zoneless CD scheduling unrelated to the mutation itself
    // settles; the app should still be unstable because of the mutation's own pending task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stable).toBe(false);

    deferred.resolve('ok');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stable).toBe(true);
  });
});

describe('injector option', () => {
  it('works end-to-end when created outside an injection context via the injector option', async () => {
    // Simulates a factory function: no injection context / constructor call stack.
    function createMutationFromFactory() {
      const injector = TestBed.inject(EnvironmentInjector);
      return mutation<string, string>({
        mutationFn: (input) => Promise.resolve(`created:${input}`),
        injector,
      });
    }

    const m = createMutationFromFactory();
    expect(await m.mutate('todo')).toBe('created:todo');
    expect(m.status()).toBe('success');
  });

  it('throws when created outside an injection context without the injector option', () => {
    expect(() => mutation<void, string>({ mutationFn: () => Promise.resolve('ok') })).toThrow();
  });

  it('ignores the result if the injector is destroyed while the mutation is in flight', async () => {
    const deferred = createDeferred<string>();
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);
    let abortSignal!: AbortSignal;

    const m = mutation<void, string>({
      mutationFn: (_input, signal) => {
        abortSignal = signal;
        return deferred.promise;
      },
      injector: childInjector,
    });

    const call = m.mutate();
    expect(abortSignal.aborted).toBe(false);

    childInjector.destroy();
    expect(abortSignal.aborted).toBe(true);

    deferred.resolve('too late');
    await call;

    expect(m.status()).toBe('pending');
    expect(m.value()).toBeUndefined();
  });

  it('rejects a mutate() call with the abort error when the injector is destroyed mid-flight', async () => {
    const deferred = createDeferred<string>();
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);

    const m = mutation<void, string>({
      mutationFn: (_input, signal) => {
        signal.addEventListener('abort', () => {
          deferred.reject(new DOMException('Aborted', 'AbortError'));
        });
        return deferred.promise;
      },
      injector: childInjector,
    });

    const call = m.mutate();

    childInjector.destroy();

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });
});

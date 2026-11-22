import {
  provideZonelessChangeDetection,
  EnvironmentInjector,
  createEnvironmentInjector,
  ErrorHandler,
} from '@angular/core';
import { SIGNAL } from '@angular/core/primitives/signals';
import { TestBed } from '@angular/core/testing';
import { expectTypeOf } from 'vitest';
import { mutation } from './mutation';
import type { MutationRef } from './mutation.types';
import { createDeferred, createMutation, sequencedMutationFn, queueTurn } from './testing/mutation';

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

    expect(onSuccess).toHaveBeenCalledWith('task-done', 'task', { isLatest: true });
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

    expect(onError).toHaveBeenCalledWith(failure, 'task', { isLatest: true });
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

    expect(onSettled).toHaveBeenCalledWith('task-done', undefined, 'task', { isLatest: true });
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

    expect(onSettled).toHaveBeenCalledWith(undefined, failure, 'task', { isLatest: true });
    expect(calls).toEqual(['onError', 'onSettled']);
  });
});

describe('callback exceptions', () => {
  function spyOnErrorHandler() {
    return vi.spyOn(TestBed.inject(ErrorHandler), 'handleError').mockImplementation(() => undefined);
  }

  it('keeps the success when onSuccess throws, and reports the exception to ErrorHandler', async () => {
    const handleError = spyOnErrorHandler();
    const callbackError = new Error('onSuccess failed');
    const onError = vi.fn();
    const onSettled = vi.fn();
    const m = createMutation<string, string>({
      mutationFn: (input) => Promise.resolve(`${input}-done`),
      onSuccess: () => {
        throw callbackError;
      },
      onError,
      onSettled,
    });

    await expect(m.mutate('task')).resolves.toBe('task-done');

    expect(m.status()).toBe('success');
    expect(m.error()).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('task-done', undefined, 'task', { isLatest: true });
    expect(handleError).toHaveBeenCalledExactlyOnceWith(callbackError);
  });

  it('keeps the original error when onError throws, and reports the exception to ErrorHandler', async () => {
    const handleError = spyOnErrorHandler();
    const failure = new Error('boom');
    const callbackError = new Error('onError failed');
    const onSettled = vi.fn();
    const m = createMutation<string, string>({
      mutationFn: () => Promise.reject(failure),
      onError: () => {
        throw callbackError;
      },
      onSettled,
    });

    await expect(m.mutate('task')).rejects.toBe(failure);

    expect(m.error()).toBe(failure);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(undefined, failure, 'task', { isLatest: true });
    expect(handleError).toHaveBeenCalledExactlyOnceWith(callbackError);
  });

  it('keeps the success when onSettled throws, and reports the exception to ErrorHandler', async () => {
    const handleError = spyOnErrorHandler();
    const callbackError = new Error('onSettled failed');
    const onError = vi.fn();
    const m = createMutation<void, string>({
      mutationFn: () => Promise.resolve('ok'),
      onError,
      onSettled: () => {
        throw callbackError;
      },
    });

    await expect(m.mutate()).resolves.toBe('ok');

    expect(m.status()).toBe('success');
    expect(onError).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledExactlyOnceWith(callbackError);
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

});

describe('returned promise', () => {
  it('does not report an unhandled rejection when the caller ignores it', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const m = createMutation<void, string>({ mutationFn: () => Promise.reject(new Error('boom')) });

      void m.mutate();
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

describe('reset()', () => {
  it('resets status/value/error/input to their initial state', async () => {
    const m = createMutation<string, string>({ mutationFn: (input) => Promise.resolve(input) });

    await m.mutate('task');
    expect(m.status()).toBe('success');

    m.reset();
    expect(m.status()).toBe('idle');
    expect(m.value()).toBeUndefined();
    expect(m.error()).toBeUndefined();
    expect(m.input()).toBeUndefined();
  });

  it("aborts an in-flight call's signal with an 'Aborted' AbortError as its reason", () => {
    let abortSignal!: AbortSignal;
    const m = createMutation<void, string>({
      mutationFn: (_input, signal) => {
        abortSignal = signal;
        return new Promise<string>(() => undefined);
      },
    });

    void m.mutate();
    m.reset();

    expect(abortSignal.reason).toMatchObject({ name: 'AbortError', message: 'Aborted' });
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

  it('does not call the callbacks of a call it aborted, whether it then resolves or rejects', async () => {
    const resolved = createDeferred<string>();
    const rejected = createDeferred<string>();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const m = createMutation<void, string>({
      mutationFn: sequencedMutationFn(resolved, rejected),
      onSuccess,
      onError,
      onSettled,
    });

    const resolvedCall = m.mutate();
    const rejectedCall = m.mutate();
    m.reset();

    resolved.resolve('too late');
    rejected.reject(new DOMException('Aborted', 'AbortError'));
    await resolvedCall;
    await rejectedCall.catch(() => undefined);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('does not call the callbacks of a call still queued when it runs', async () => {
    const first = createDeferred<string>();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const m = createMutation<void, string>({
      concurrency: 'queue',
      mutationFn: sequencedMutationFn(first),
      onError,
      onSettled,
    });

    const runningCall = m.mutate();
    const queuedCall = m.mutate();
    await queueTurn();
    m.reset();
    first.resolve('first');

    await runningCall;
    await expect(queuedCall).rejects.toMatchObject({ name: 'AbortError' });
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
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

describe('MutationRef type parameters', () => {
  it('takes TError third, in the same order as mutation(), with TValue defaulted last', () => {
    const m = createMutation<string, number, Error>({ mutationFn: () => Promise.resolve(1) });

    expectTypeOf(m).toEqualTypeOf<MutationRef<string, number, Error>>();
    expectTypeOf<MutationRef<string, number, Error>>().toEqualTypeOf<
      MutationRef<string, number, Error, number | undefined>
    >();
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
    expect(() => mutation<void, string>({ mutationFn: () => Promise.resolve('ok') })).toThrow(/mutation/);
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

  it('does not call the callbacks of a call in flight when the injector is destroyed', async () => {
    const deferred = createDeferred<string>();
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);
    const onSuccess = vi.fn();
    const onSettled = vi.fn();

    const m = mutation<void, string>({
      mutationFn: () => deferred.promise,
      onSuccess,
      onSettled,
      injector: childInjector,
    });

    const call = m.mutate();
    childInjector.destroy();
    deferred.resolve('too late');
    await call;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
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

  it('rejects a mutate() call made after the injector is destroyed, without calling mutationFn', async () => {
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);
    const mutationFn = vi.fn(() => Promise.resolve('sent anyway'));
    const m = mutation<void, string>({ mutationFn, injector: childInjector });

    childInjector.destroy();

    await expect(m.mutate()).rejects.toMatchObject({ name: 'AbortError', message: 'Destroyed' });
    expect(mutationFn).not.toHaveBeenCalled();
    expect(m.status()).toBe('idle');
  });
});

describe('debugName', () => {
  const debugNameOf = (signal: object) => (signal as { [SIGNAL]: { debugName?: string } })[SIGNAL].debugName;

  it('names the state signals for Angular DevTools', () => {
    const m = TestBed.runInInjectionContext(() =>
      mutation<string, string>({ mutationFn: async (input) => input, debugName: 'save' }),
    );

    expect([m.status, m.value, m.error, m.input, m.pendingInputs].map(debugNameOf)).toEqual([
      'save.status',
      'save.value',
      'save.error',
      'save.input',
      'save.pendingInputs',
    ]);
  });

  it('leaves them unnamed without a debugName', () => {
    const m = TestBed.runInInjectionContext(() => mutation<string, string>({ mutationFn: async (input) => input }));

    expect(debugNameOf(m.status)).toBeUndefined();
  });
});

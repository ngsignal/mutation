import { expectTypeOf } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  provideZonelessChangeDetection,
  EnvironmentInjector,
  createEnvironmentInjector,
  PendingTasks,
  ApplicationRef,
} from '@angular/core';
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

describe('mutation()', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('goes through pending then success with the returned value', async () => {
    const deferred = createDeferred<string>();
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => deferred.promise }),
    );

    expect(m.status()).toBe('idle');

    const call = m.mutate();
    expect(m.status()).toBe('pending');
    expect(m.isPending()).toBe(true);

    deferred.resolve('ok');
    await call;

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('ok');
    expect(m.isPending()).toBe(false);
  });

  it('calls onSuccess with the output and input after a success', async () => {
    const onSuccess = vi.fn();
    const m = TestBed.runInInjectionContext(() =>
      mutation<string, string>({
        mutationFn: (input) => Promise.resolve(`${input}-done`),
        onSuccess,
      }),
    );

    await m.mutate('task');

    expect(onSuccess).toHaveBeenCalledWith('task-done', 'task');
  });

  it('goes into error state if mutationFn rejects', async () => {
    const deferred = createDeferred<string>();
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => deferred.promise }),
    );

    const call = m.mutate().catch(() => undefined);
    deferred.reject(new Error('boom'));
    await call;

    expect(m.status()).toBe('error');
    expect((m.error() as Error).message).toBe('boom');
  });

  it('calls onError with the error and input after a rejection', async () => {
    const onError = vi.fn();
    const failure = new Error('boom');
    const m = TestBed.runInInjectionContext(() =>
      mutation<string, string>({ mutationFn: () => Promise.reject(failure), onError }),
    );

    await m.mutate('task').catch(() => undefined);

    expect(onError).toHaveBeenCalledWith(failure, 'task');
  });

  it('keeps the previous value when a later mutation fails', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const calls = [first, second];
    let callIndex = 0;

    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => calls[callIndex++].promise }),
    );

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
    const calls = [first, second];
    let callIndex = 0;

    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => calls[callIndex++].promise }),
    );

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
    const calls = [first, second];
    let callIndex = 0;
    const onError = vi.fn();

    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => calls[callIndex++].promise, onError }),
    );

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
    const calls = [first, second];
    let callIndex = 0;
    const onError = vi.fn();

    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => calls[callIndex++].promise, onError }),
    );

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

  it('does not abort a previous mutation when a new one starts', () => {
    const abortSignals: AbortSignal[] = [];
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, void>({
        mutationFn: (_input, signal) => {
          abortSignals.push(signal);
          return new Promise<void>(() => {});
        },
      }),
    );

    m.mutate();
    expect(abortSignals[0].aborted).toBe(false);

    m.mutate();
    expect(abortSignals[0].aborted).toBe(false);
    expect(abortSignals[1].aborted).toBe(false);
  });

  it('reset() resets status/value/error to their initial state', async () => {
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => Promise.resolve('ok') }),
    );

    await m.mutate();
    expect(m.status()).toBe('success');

    m.reset();
    expect(m.status()).toBe('idle');
    expect(m.value()).toBeUndefined();
    expect(m.error()).toBeUndefined();
  });

  it('reset() ignores the result of a mutation that was still in flight', async () => {
    const deferred = createDeferred<string>();
    let abortSignal!: AbortSignal;
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({
        mutationFn: (_input, signal) => {
          abortSignal = signal;
          return deferred.promise;
        },
      }),
    );

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

  it('hasValue() reflects whether value() is set', async () => {
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => Promise.resolve('ok') }),
    );

    expect(m.hasValue()).toBe(false);

    await m.mutate();

    expect(m.hasValue()).toBe(true);
    expect(m.value()).toBe('ok');
  });

  it('types value() as TOutput once hasValue() narrows it', () => {
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => Promise.resolve('ok') }),
    );

    expectTypeOf(m.value()).toEqualTypeOf<string | undefined>();

    if (m.hasValue()) {
      expectTypeOf(m.value()).toEqualTypeOf<string>();
    }
  });

  it('keeps the pending task of a superseded call open until its own mutationFn settles', async () => {
    const removeFns = spyOnPendingTasks();

    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const calls = [first, second];
    let callIndex = 0;

    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => calls[callIndex++].promise }),
    );

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
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => deferred.promise }),
    );

    const call = m.mutate();
    expect(removeFns[0]).not.toHaveBeenCalled();

    m.reset();
    expect(removeFns[0]).toHaveBeenCalledTimes(1);

    deferred.resolve('too late');
    await call;
  });

  it('does not release the pending task or abort the controller again when reset() follows a settled mutation', async () => {
    const removeFns = spyOnPendingTasks();

    let abortSignal!: AbortSignal;
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({
        mutationFn: (_input, signal) => {
          abortSignal = signal;
          return Promise.resolve('ok');
        },
      }),
    );

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
    const m = TestBed.runInInjectionContext(() =>
      mutation<void, string>({ mutationFn: () => deferred.promise }),
    );

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

  it('works end-to-end when created outside an injection context via the injector option', async () => {
    // Simulates a factory function: no TestBed.runInInjectionContext / constructor call stack.
    function createMutation() {
      const injector = TestBed.inject(EnvironmentInjector);
      return mutation<string, string>({
        mutationFn: (input) => Promise.resolve(`created:${input}`),
        injector,
      });
    }

    const m = createMutation();
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

  it('types error() and onError() as TError instead of unknown', () => {
    const m = TestBed.runInInjectionContext(() =>
      mutation<string, string, Error>({
        mutationFn: (input) => Promise.resolve(input),
        onError: (err) => expectTypeOf(err).toEqualTypeOf<Error>(),
      }),
    );

    expectTypeOf(m.error).returns.toEqualTypeOf<Error | undefined>();
  });
});

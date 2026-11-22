import {
  provideZonelessChangeDetection,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { mutation } from './mutation';
import { spyOnPendingTasks, createDeferred, createMutation, sequencedMutationFn, queueTurn } from './testing/mutation';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
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

  it('keeps the rejection of a stale call out of the signals when a more recent mutation has already succeeded', async () => {
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
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error('too late'), undefined, { isLatest: false });
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
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'AbortError' }), undefined, {
      isLatest: false,
    });
  });

  it('reflects the most recently submitted input as soon as mutate() is called', () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();

    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second) });

    void m.mutate('first');
    expect(m.input()).toBe('first');

    void m.mutate('second');
    expect(m.input()).toBe('second');
  });

  it('still calls the callbacks of a stale call, with isLatest: false, without touching the signals', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const onSuccess = vi.fn();
    const onSettled = vi.fn();

    const m = createMutation<string, string>({
      mutationFn: sequencedMutationFn(first, second),
      onSuccess,
      onSettled,
    });

    const firstCall = m.mutate('a');
    const secondCall = m.mutate('b');

    second.resolve('second');
    await secondCall;
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('second', 'b', { isLatest: true });
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('second', undefined, 'b', { isLatest: true });

    first.resolve('first');
    await firstCall;
    expect(onSuccess).toHaveBeenLastCalledWith('first', 'a', { isLatest: false });
    expect(onSettled).toHaveBeenLastCalledWith('first', undefined, 'a', { isLatest: false });
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(m.value()).toBe('second');
    expect(m.input()).toBe('b');
  });

  it('does not abort a previous mutation when a new one starts', () => {
    const abortSignals: AbortSignal[] = [];
    const m = createMutation<void, void>({
      mutationFn: (_input, signal) => {
        abortSignals.push(signal);
        return new Promise<void>(() => {});
      },
    });

    void m.mutate();
    expect(abortSignals[0].aborted).toBe(false);

    void m.mutate();
    expect(abortSignals[0].aborted).toBe(false);
    expect(abortSignals[1].aborted).toBe(false);
  });

});

describe("concurrency: 'parallel'", () => {
  it('runs every call at once, like the default, and the latest one wins', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const mutationFn = vi.fn(sequencedMutationFn(first, second));
    const m = createMutation<void, string>({ mutationFn, concurrency: 'parallel' });

    const firstCall = m.mutate();
    const secondCall = m.mutate();
    expect(mutationFn).toHaveBeenCalledTimes(2);

    second.resolve('second');
    first.resolve('first');
    await Promise.all([firstCall, secondCall]);
    expect(m.value()).toBe('second');
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
    expect(onSuccess.mock.calls).toEqual([
      ['first-done', undefined, { isLatest: false }],
      ['second-done', undefined, { isLatest: true }],
    ]);
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

    await queueTurn();
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

    await queueTurn();
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

    void m.mutate('first');
    const secondCall = m.mutate('second').catch(() => undefined);

    await queueTurn();
    expect(started).toEqual(['first']);

    childInjector.destroy();

    first.resolve('first-done');
    await secondCall;

    expect(started).toEqual(['first']);
  });

  it('rejects a call still queued as soon as reset() runs, even if the call ahead ignores its AbortSignal', async () => {
    const m = createMutation<string, string>({
      concurrency: 'queue',
      mutationFn: () => new Promise<string>(() => undefined),
    });

    void m.mutate('first');
    const secondCall = m.mutate('second');

    await queueTurn();
    m.reset();

    await expect(secondCall).rejects.toMatchObject({ name: 'AbortError', message: 'NotStarted' });
  });

  it('rejects a call still queued as soon as the injector is destroyed, even if the call ahead ignores its AbortSignal', async () => {
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);
    const m = mutation<string, string>({
      concurrency: 'queue',
      mutationFn: () => new Promise<string>(() => undefined),
      injector: childInjector,
    });

    void m.mutate('first');
    const secondCall = m.mutate('second');

    await queueTurn();
    childInjector.destroy();

    await expect(secondCall).rejects.toMatchObject({ name: 'AbortError', message: 'NotStarted' });
  });

  it('keeps a call made after reset() behind an in-flight call that ignores its AbortSignal', async () => {
    const first = createDeferred<string>();
    const started: string[] = [];

    const m = createMutation<string, string>({
      concurrency: 'queue',
      mutationFn: (input) => {
        started.push(input);
        return input === 'first' ? first.promise : Promise.resolve('after-reset-done');
      },
    });

    void m.mutate('first');
    await queueTurn();
    m.reset();

    const afterResetCall = m.mutate('after-reset');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['first']);

    first.resolve('first-done');
    await expect(afterResetCall).resolves.toBe('after-reset-done');
    expect(started).toEqual(['first', 'after-reset']);
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
    expect(onSuccess).toHaveBeenCalledWith('first-done', 'first', { isLatest: true });
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

      void m.mutate();
      void m.mutate();
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

  it('unlocks after a mutationFn that throws synchronously', async () => {
    const m = createMutation<string, string>({
      concurrency: 'drop',
      mutationFn: (input) => {
        if (input === 'bad') throw new Error('sync');
        return Promise.resolve(input);
      },
    });

    await expect(m.mutate('bad')).rejects.toThrow('sync');
    expect(m.status()).toBe('error');
    await expect(m.mutate('good')).resolves.toBe('good');
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

describe('properties', () => {
  interface Call {
    id: number;
    succeeds: boolean;
  }

  const callsArb = fc
    .array(fc.boolean(), { minLength: 1, maxLength: 8 })
    .map((outcomes): Call[] => outcomes.map((succeeds, id) => ({ id, succeeds })));

  /** A mutationFn whose calls settle in the order fast-check's scheduler picks. */
  function scheduledMutationFn(scheduler: fc.Scheduler) {
    const started: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    async function mutationFn(call: Call): Promise<number> {
      started.push(call.id);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await scheduler.schedule(Promise.resolve());
      } finally {
        inFlight--;
      }
      if (!call.succeeds) {
        throw new Error(`failed ${call.id}`);
      }
      return call.id;
    }

    return { mutationFn, started, maxInFlight: () => maxInFlight };
  }

  it('commits only the latest call, whatever order the calls settle in', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), callsArb, async (scheduler, calls) => {
        const { mutationFn } = scheduledMutationFn(scheduler);
        const onSettled = vi.fn();
        const m = createMutation<Call, number>({ mutationFn, onSettled });

        const promises = calls.map((call) => m.mutate(call));
        await scheduler.waitFor(Promise.allSettled(promises));

        const latest = calls[calls.length - 1];
        expect(m.input()).toBe(latest);
        expect(m.status()).toBe(latest.succeeds ? 'success' : 'error');
        expect(m.value()).toBe(latest.succeeds ? latest.id : undefined);
        expect(onSettled).toHaveBeenCalledTimes(calls.length);
        for (const [, , input, context] of onSettled.mock.calls) {
          expect(context.isLatest).toBe(input === latest);
        }
      }),
    );
  });

  it("'queue' runs calls one at a time, in call order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), callsArb, async (scheduler, calls) => {
        const { mutationFn, started, maxInFlight } = scheduledMutationFn(scheduler);
        const m = createMutation<Call, number>({ mutationFn, concurrency: 'queue' });

        const promises = calls.map((call) => m.mutate(call));
        await scheduler.waitFor(Promise.allSettled(promises));

        expect(started).toEqual(calls.map((call) => call.id));
        expect(maxInFlight()).toBe(1);
        expect(m.status()).toBe(calls[calls.length - 1].succeeds ? 'success' : 'error');
      }),
    );
  });

  it("'drop' rejects every call made while one is pending and never overlaps calls", async () => {
    const stepsArb = fc.array(fc.record({ succeeds: fc.boolean(), settleFirst: fc.boolean() }), {
      minLength: 1,
      maxLength: 8,
    });

    await fc.assert(
      fc.asyncProperty(fc.scheduler(), stepsArb, async (scheduler, steps) => {
        const { mutationFn, started, maxInFlight } = scheduledMutationFn(scheduler);
        const m = createMutation<Call, number>({ mutationFn, concurrency: 'drop' });
        const promises: Promise<number>[] = [];
        const droppedIds: number[] = [];

        for (const [id, step] of steps.entries()) {
          if (step.settleFirst) {
            await scheduler.waitFor(Promise.allSettled(promises));
          }
          if (m.isPending()) {
            droppedIds.push(id);
          }
          promises.push(m.mutate({ id, succeeds: step.succeeds }));
        }
        const results = await scheduler.waitFor(Promise.allSettled(promises));

        expect(maxInFlight()).toBe(1);
        expect(started).toEqual(steps.map((_, id) => id).filter((id) => !droppedIds.includes(id)));
        for (const id of droppedIds) {
          expect(results[id]).toMatchObject({
            status: 'rejected',
            reason: { name: 'AbortError', message: 'Dropped' },
          });
        }
      }),
    );
  });
});

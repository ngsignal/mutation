import {
  provideZonelessChangeDetection,
  EnvironmentInjector,
  createEnvironmentInjector,
  ApplicationRef,
  computed,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectTypeOf } from 'vitest';
import { spyOnPendingTasks, createDeferred, createMutation, sequencedMutationFn } from '../testing/mutation';
import { mutation } from './mutation';
import type { MutationRef } from './mutation.types';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
});

describe('pendingInputs()', () => {
  it('is empty before the first mutate() call', () => {
    const m = createMutation<string, string>({ mutationFn: () => Promise.resolve('ok') });

    expect(m.pendingInputs()).toEqual([]);
  });

  it('types its items as TInput', () => {
    const m = createMutation<number, string>({ mutationFn: () => Promise.resolve('ok') });

    expectTypeOf(m.pendingInputs()).toEqualTypeOf<readonly number[]>();
  });

  it('keeps a superseded call after the latest one has settled', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second) });

    const firstCall = m.mutate('a');
    const secondCall = m.mutate('b');
    expect(m.pendingInputs()).toEqual(['a', 'b']);

    second.resolve('second');
    await secondCall;
    expect(m.pendingInputs()).toEqual(['a']);

    first.resolve('first');
    await firstCall;
    expect(m.pendingInputs()).toEqual([]);
  });

  it('removes a call that settles before the others and keeps the rest in call order', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const third = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second, third) });

    void m.mutate('a');
    const secondCall = m.mutate('b');
    void m.mutate('c');

    second.resolve('second');
    await secondCall;

    expect(m.pendingInputs()).toEqual(['a', 'c']);
  });

  it('removes a call once it fails', async () => {
    const deferred = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: () => deferred.promise });

    const call = m.mutate('a');
    expect(m.pendingInputs()).toEqual(['a']);

    deferred.reject(new Error('boom'));
    await expect(call).rejects.toThrow('boom');
    expect(m.pendingInputs()).toEqual([]);
  });

  it('keeps an input called twice until both of its calls have settled', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second) });

    const firstCall = m.mutate('a');
    void m.mutate('a');
    expect(m.pendingInputs()).toEqual(['a', 'a']);

    first.resolve('first');
    await firstCall;
    expect(m.pendingInputs()).toEqual(['a']);
  });

  it('removes a call whose mutationFn throws synchronously', async () => {
    const m = createMutation<string, string>({
      mutationFn: () => {
        throw new Error('sync');
      },
    });

    await expect(m.mutate('a')).rejects.toThrow('sync');
    expect(m.pendingInputs()).toEqual([]);
  });

  it('lists a call made from a computed', () => {
    const m = createMutation<string, string>({ mutationFn: () => new Promise<string>(() => {}) });
    const startsCall = computed(() => m.mutate('a'));

    void startsCall();

    expect(m.pendingInputs()).toEqual(['a']);
  });

  it("includes calls still waiting in the queue with concurrency: 'queue'", () => {
    const m = createMutation<string, string>({
      mutationFn: () => new Promise<string>(() => {}),
      concurrency: 'queue',
    });

    void m.mutate('a');
    void m.mutate('b');

    expect(m.pendingInputs()).toEqual(['a', 'b']);
  });

  it("leaves out a call dropped with concurrency: 'drop'", async () => {
    const m = createMutation<string, string>({
      mutationFn: () => new Promise<string>(() => {}),
      concurrency: 'drop',
    });

    void m.mutate('a');
    await expect(m.mutate('b')).rejects.toMatchObject({ name: 'AbortError' });

    expect(m.pendingInputs()).toEqual(['a']);
  });

  it('is emptied by reset(), even if a mutationFn ignores its AbortSignal', () => {
    const m = createMutation<string, string>({ mutationFn: () => new Promise<string>(() => {}) });

    void m.mutate('a');
    void m.mutate('b');
    m.reset();

    expect(m.pendingInputs()).toEqual([]);
  });

  it('is emptied when the injector is destroyed', () => {
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const m = mutation<string, string>({ mutationFn: () => new Promise<string>(() => {}), injector });

    void m.mutate('a');
    injector.destroy();

    expect(m.pendingInputs()).toEqual([]);
  });

  it('does not touch the list when a call aborted by reset() settles later', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second) });

    const firstCall = m.mutate('a');
    m.reset();
    void m.mutate('b');

    first.resolve('first');
    await firstCall;

    expect(m.pendingInputs()).toEqual(['b']);
  });

  it('keeps the same array when a call aborted by reset() settles later', async () => {
    const deferred = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: () => deferred.promise });

    const call = m.mutate('a');
    m.reset();
    const afterReset = m.pendingInputs();
    deferred.resolve('too late');
    await call;

    expect(m.pendingInputs()).toBe(afterReset);
  });

  it('keeps the same array when reset() finds no call in flight', async () => {
    const m = createMutation<string, string>({ mutationFn: () => Promise.resolve('ok') });

    await m.mutate('a');
    const beforeReset = m.pendingInputs();
    m.reset();

    expect(m.pendingInputs()).toBe(beforeReset);
  });

  it('no longer lists a call when its callbacks run', async () => {
    const seen: (readonly string[])[] = [];
    const m: MutationRef<string, string> = createMutation<string, string>({
      mutationFn: (input) => (input === 'ok' ? Promise.resolve('done') : Promise.reject(new Error('failed'))),
      onSettled: () => seen.push(m.pendingInputs()),
    });

    await m.mutate('ok');
    await m.mutate('ko').catch(() => undefined);

    expect(seen).toEqual([[], []]);
  });
});

describe('isPending()', () => {
  it('stays true while a superseded call is in flight after the latest one succeeded', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const m = createMutation<string, string>({ mutationFn: sequencedMutationFn(first, second) });

    const firstCall = m.mutate('a');
    const secondCall = m.mutate('b');
    second.resolve('second');
    await secondCall;

    expect(m.status()).toBe('success');
    expect(m.isPending()).toBe(true);

    first.resolve('first');
    await firstCall;

    expect(m.isPending()).toBe(false);
  });

  it('is false in onSuccess when no other call is in flight', async () => {
    let seen: { status: string; isPending: boolean } | undefined;
    const m: MutationRef<void, string> = createMutation<void, string>({
      mutationFn: () => Promise.resolve('ok'),
      onSuccess: () => (seen = { status: m.status(), isPending: m.isPending() }),
    });

    await m.mutate();

    expect(seen).toEqual({ status: 'success', isPending: false });
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

    void m.mutate();

    let stable = false;
    void applicationRef.whenStable().then(() => {
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

  it('releases the pending task once the callbacks have run, so a call they start keeps the app unstable', async () => {
    const removeFns = spyOnPendingTasks();
    let releasedDuringCallbacks: boolean | undefined;
    const m: MutationRef<string, string> = createMutation<string, string>({
      mutationFn: (input) => (input === 'first' ? Promise.resolve('ok') : new Promise<string>(() => undefined)),
      onSuccess: (_output, input) => {
        if (input === 'first') void m.mutate('chained');
      },
      onSettled: () => (releasedDuringCallbacks = removeFns[0].mock.calls.length > 0),
    });

    await m.mutate('first');

    expect(releasedDuringCallbacks).toBe(false);
    expect(removeFns[0]).toHaveBeenCalledOnce();
    expect(removeFns[1]).not.toHaveBeenCalled();
  });
});

import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectTypeOf } from 'vitest';
import { createMutation, queueTurn } from '../testing/mutation';
import { wasNeverSent } from './abort-error';
import { mutation } from './mutation';
import { mutationQueue } from './mutation-queue';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
});

const pending = () => new Promise<string>(() => undefined);

describe('wasNeverSent()', () => {
  it("is true for a call dropped by concurrency: 'drop'", async () => {
    const m = createMutation<void, string>({ mutationFn: pending, concurrency: 'drop' });

    void m.mutate();
    const error: unknown = await m.mutate().catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(true);
  });

  it('is true for a call still queued when reset() runs', async () => {
    const m = createMutation<void, string>({ mutationFn: pending, concurrency: 'queue' });

    void m.mutate();
    const queuedCall = m.mutate();
    await queueTurn();
    m.reset();
    const error: unknown = await queuedCall.catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(true);
  });

  it('is true for a call made after the injector is destroyed', async () => {
    const childInjector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const m = mutation<void, string>({ mutationFn: pending, injector: childInjector });

    childInjector.destroy();
    const error: unknown = await m.mutate().catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(true);
  });

  it('is false for a call in flight when reset() runs: its write may have left', async () => {
    const m = createMutation<void, string>({ mutationFn: pending });

    const call = m.mutate();
    m.reset();
    const error: unknown = await call.catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(false);
  });

  it('is false for an error from mutationFn', async () => {
    const m = createMutation<void, string>({ mutationFn: () => Promise.reject(new Error('Dropped')) });

    const error: unknown = await m.mutate().catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(false);
  });

  it("is false for an AbortError the library didn't create", () => {
    expect(wasNeverSent(new DOMException('signal is aborted without reason', 'AbortError'))).toBe(false);
    expect(wasNeverSent(new DOMException('Dropped', 'TimeoutError'))).toBe(false);
    expect(wasNeverSent(new DOMException('Dropped', 'AbortError'))).toBe(false);
  });

  it("is false for an AbortError with the library's message that mutationFn rejects with", async () => {
    const m = createMutation<void, string>({
      mutationFn: () => Promise.reject(new DOMException('Dropped', 'AbortError')),
    });

    const error: unknown = await m.mutate().catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(false);
  });

  it("is false for another mutation's 'Dropped' that mutationFn rejects with: its own write may have left", async () => {
    const audit = createMutation<void, string>({ mutationFn: pending, concurrency: 'drop' });
    void audit.mutate();
    let innerNeverSent: boolean | undefined;
    const save = createMutation<void, string>({
      mutationFn: () =>
        audit.mutate().catch((innerError: unknown) => {
          innerNeverSent = wasNeverSent(innerError);
          throw innerError;
        }),
    });

    const error: unknown = await save.mutate().catch((e: unknown) => e);

    expect(innerNeverSent).toBe(true);
    expect(wasNeverSent(error)).toBe(false);
  });

  it("is true for a call still waiting in a shared queue when its mutation is reset", async () => {
    const queue = mutationQueue();
    const first = createMutation<void, string>({ mutationFn: pending, concurrency: queue });
    const second = createMutation<void, string>({ mutationFn: pending, concurrency: queue });

    void first.mutate();
    const queuedCall = second.mutate();
    await queueTurn();
    second.reset();
    const error: unknown = await queuedCall.catch((e: unknown) => e);

    expect(wasNeverSent(error)).toBe(true);
  });

  it('is false for a value that is not an error', () => {
    expect(wasNeverSent('Dropped')).toBe(false);
    expect(wasNeverSent(undefined)).toBe(false);
  });

  it("returns a boolean, not a type guard: an 'Aborted' error is a DOMException too", () => {
    expectTypeOf(wasNeverSent).returns.toEqualTypeOf<boolean>();
  });
});

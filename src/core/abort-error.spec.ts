import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectTypeOf } from 'vitest';
import { createMutation, queueTurn } from '../testing/mutation';
import { wasNeverSent } from './abort-error';
import { mutation } from './mutation';

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
  });

  it('is false for a value that is not an error', () => {
    expect(wasNeverSent('Dropped')).toBe(false);
    expect(wasNeverSent(undefined)).toBe(false);
  });

  it('narrows the error to a DOMException', () => {
    expectTypeOf(wasNeverSent).guards.toEqualTypeOf<DOMException>();
  });
});

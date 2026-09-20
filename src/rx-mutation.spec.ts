import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { rxMutation } from './rx-mutation';
import { failWith, isObserved } from './testing/rxjs';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
});

describe('lifecycle', () => {
  it('goes through pending then success with the emitted value', async () => {
    const subject = new Subject<string>();
    const m = TestBed.runInInjectionContext(() =>
      rxMutation<void, string>({ mutationFn: () => subject }),
    );

    expect(m.status()).toBe('idle');

    const call = m.mutate();
    expect(m.status()).toBe('pending');

    subject.next('ok');
    await call;

    expect(m.status()).toBe('success');
    expect(m.value()).toBe('ok');
  });
  it('goes into error state when the Observable errors', async () => {
    const failure = new Error('boom');
    const m = TestBed.runInInjectionContext(() =>
      rxMutation<void, string>({ mutationFn: () => failWith(failure) }),
    );

    await m.mutate().catch(() => undefined);

    expect(m.status()).toBe('error');
    expect(m.error()).toBe(failure);
  });
  it('rejects when the Observable completes without emitting a value', async () => {
    const subject = new Subject<string>();
    const m = TestBed.runInInjectionContext(() => rxMutation<void, string>({ mutationFn: () => subject }));

    const call = m.mutate().catch(() => undefined);
    subject.complete();
    await call;

    expect(m.status()).toBe('error');
    expect((m.error() as Error).message).toBe('Observable completed without emitting a value');
    expect(isObserved(subject)).toBe(false);
  });
  it('passes the input through to mutationFn() and onSuccess', async () => {
    const onSuccess = vi.fn();
    const m = TestBed.runInInjectionContext(() =>
      rxMutation<string, string>({
        mutationFn: (input) => of(`${input}-done`),
        onSuccess,
      }),
    );

    await m.mutate('task');

    expect(onSuccess).toHaveBeenCalledWith('task-done', 'task');
  });});

describe('cleanup', () => {
  it('unsubscribes after a normal resolve, not just on abort', async () => {
    const subject = new Subject<string>();
    const m = TestBed.runInInjectionContext(() => rxMutation<void, string>({ mutationFn: () => subject }));

    const call = m.mutate();
    expect(isObserved(subject)).toBe(true);

    subject.next('ok');
    await call;

    expect(isObserved(subject)).toBe(false);
  });

  it('unsubscribes after a normal reject', async () => {
    const subject = new Subject<string>();
    const m = TestBed.runInInjectionContext(() => rxMutation<void, string>({ mutationFn: () => subject }));

    const call = m.mutate().catch(() => undefined);
    expect(isObserved(subject)).toBe(true);

    subject.error(new Error('boom'));
    await call;

    expect(isObserved(subject)).toBe(false);
  });

  it('unsubscribes right away for a source that resolves synchronously on subscribe', async () => {
    const m = TestBed.runInInjectionContext(() => rxMutation<void, string>({ mutationFn: () => of('ok') }));

    await m.mutate();

    expect(m.value()).toBe('ok');
  });
});

describe('injection context', () => {
  it('throws, naming rxMutation, outside an injection context when no injector is given', () => {
    expect(() => rxMutation<void, string>({ mutationFn: () => of('x') })).toThrow(/rxMutation/);
  });
});

describe('options forwarded to mutation()', () => {
  it('calls onSettled after onSuccess/onError either way', async () => {
    const calls: string[] = [];
    const success = TestBed.runInInjectionContext(() =>
      rxMutation<void, string>({
        mutationFn: () => of('ok'),
        onSuccess: () => calls.push('onSuccess'),
        onSettled: () => calls.push('onSettled'),
      }),
    );
    await success.mutate();
    expect(calls).toEqual(['onSuccess', 'onSettled']);

    calls.length = 0;
    const failure = TestBed.runInInjectionContext(() =>
      rxMutation<void, string>({
        mutationFn: () => failWith(new Error('boom')),
        onError: () => calls.push('onError'),
        onSettled: () => calls.push('onSettled'),
      }),
    );
    await failure.mutate().catch(() => undefined);
    expect(calls).toEqual(['onError', 'onSettled']);
  });

  it('serializes calls in submission order with concurrency: "queue"', async () => {
    const started: number[] = [];
    const subjects = [new Subject<string>(), new Subject<string>()];
    let callIndex = 0;

    const m = TestBed.runInInjectionContext(() =>
      rxMutation<void, string>({
        concurrency: 'queue',
        mutationFn: () => {
          const index = callIndex++;
          started.push(index);
          return subjects[index];
        },
      }),
    );

    const first = m.mutate();
    const second = m.mutate();
    await Promise.resolve(); // let the queue's microtask dequeue the first call

    // The second call's mutationFn() must not run before the first one settles.
    expect(started).toEqual([0]);

    subjects[0].next('first');
    await first;
    expect(started).toEqual([0, 1]);

    subjects[1].next('second');
    await second;
    expect(m.value()).toBe('second');
  });
});

describe('cancellation', () => {
  it('unsubscribes and rejects with AbortError when the injector is destroyed mid-flight', async () => {
    const subject = new Subject<string>();
    const parentInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], parentInjector);

    const m = rxMutation<void, string>({ mutationFn: () => subject, injector: childInjector });

    const call = m.mutate();
    expect(isObserved(subject)).toBe(true);

    childInjector.destroy();
    expect(isObserved(subject)).toBe(false);

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });

});

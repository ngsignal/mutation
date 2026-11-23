import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import fc from 'fast-check';
import { Subject } from 'rxjs';
import { expectTypeOf } from 'vitest';
import { httpMutation } from '../http/http-mutation';
import { rxMutation } from '../rxjs-interop/rx-mutation';
import { createDeferred, createMutation, nextTask } from '../testing/mutation';
import { isObserved } from '../testing/rxjs';
import { mutation } from './mutation';
import { mutationQueue, writeQueueOf } from './mutation-queue';
import type { MutationRef } from './mutation.types';

let httpTesting: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
  });
  httpTesting = TestBed.inject(HttpTestingController);
});

/** A mutationFn that records the inputs it starts, each one settled by hand. */
function manualWrites() {
  const started: string[] = [];
  const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();
  const deferredOf = (input: string) => {
    const deferred = deferreds.get(input);
    if (!deferred) throw new Error(`${input} has not started`);
    return deferred;
  };
  return {
    started,
    mutationFn: (input: string) => {
      started.push(input);
      const deferred = createDeferred<string>();
      deferreds.set(input, deferred);
      return deferred.promise;
    },
    resolve: (input: string) => deferredOf(input).resolve(`${input}-done`),
    reject: (input: string) => deferredOf(input).reject(new Error(`${input} failed`)),
  };
}

describe('mutationQueue() shared by several mutations', () => {
  it('runs the calls of every mutation sharing it one at a time, in call order', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const remove = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });

    const renameCall = rename.mutate('rename');
    const removeCall = remove.mutate('remove');
    await nextTask();
    expect(writes.started).toEqual(['rename']);

    writes.resolve('rename');
    await renameCall;
    await nextTask();
    expect(writes.started).toEqual(['rename', 'remove']);

    writes.resolve('remove');
    await expect(removeCall).resolves.toBe('remove-done');
  });

  it("sends an httpMutation()'s request only once the call ahead, from a mutation(), has settled", async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const create = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const update = TestBed.runInInjectionContext(() =>
      httpMutation<number, unknown>({
        request: (quantity) => ({ method: 'PATCH', url: '/api/lines/1', body: { quantity } }),
        concurrency: queue,
      }),
    );

    const createCall = create.mutate('create');
    const updateCall = update.mutate(3);
    await nextTask();
    httpTesting.expectNone('/api/lines/1');

    writes.resolve('create');
    await createCall;
    await nextTask();
    httpTesting.expectOne('/api/lines/1').flush({ quantity: 3 });

    await expect(updateCall).resolves.toEqual({ quantity: 3 });
  });

  it("subscribes to an rxMutation()'s Observable only once the call ahead, from an httpMutation(), has settled", async () => {
    const queue = mutationQueue();
    const notification = new Subject<string>();
    const create = TestBed.runInInjectionContext(() =>
      httpMutation<void, unknown>({ request: () => ({ method: 'POST', url: '/api/lines' }), concurrency: queue }),
    );
    const notify = TestBed.runInInjectionContext(() =>
      rxMutation<void, string>({ mutationFn: () => notification, concurrency: queue }),
    );

    const createCall = create.mutate();
    const notifyCall = notify.mutate();
    await nextTask();
    expect(isObserved(notification)).toBe(false);

    httpTesting.expectOne('/api/lines').flush({ id: 1 });
    await createCall;
    await nextTask();
    expect(isObserved(notification)).toBe(true);

    notification.next('sent');
    notification.complete();
    await expect(notifyCall).resolves.toBe('sent');
  });

  it('runs the next call once the call ahead, from another mutation, has failed', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const remove = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });

    const renameCall = rename.mutate('rename');
    const removeCall = remove.mutate('remove');
    await nextTask();
    writes.reject('rename');
    await expect(renameCall).rejects.toThrow('rename failed');
    await nextTask();

    expect(writes.started).toEqual(['rename', 'remove']);
    writes.resolve('remove');
    await expect(removeCall).resolves.toBe('remove-done');
  });

  it("keeps each mutation's signals on its own calls", async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const remove = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });

    const renameCall = rename.mutate('rename');
    void remove.mutate('remove');
    await nextTask();
    writes.resolve('rename');
    await renameCall;

    expect(rename.status()).toBe('success');
    expect(rename.pendingInputs()).toEqual([]);
    expect(remove.status()).toBe('pending');
    expect(remove.pendingInputs()).toEqual(['remove']);
  });

  it("rejects only the mutation's own queued calls on its reset(), with 'NotStarted'", async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const remove = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });

    const firstRename = rename.mutate('rename-1');
    const secondRename = rename.mutate('rename-2');
    const removeCall = remove.mutate('remove');
    await nextTask();
    remove.reset();

    await expect(removeCall).rejects.toMatchObject({ name: 'AbortError', message: 'NotStarted' });
    writes.resolve('rename-1');
    await firstRename;
    await nextTask();
    expect(writes.started).toEqual(['rename-1', 'rename-2']);
    writes.resolve('rename-2');
    await expect(secondRename).resolves.toBe('rename-2-done');
  });

  it("rejects only the mutation's own queued calls when its injector is destroyed", async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const childInjector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const remove = mutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue, injector: childInjector });

    const renameCall = rename.mutate('rename-1');
    const removeCall = remove.mutate('remove');
    const nextRename = rename.mutate('rename-2');
    await nextTask();
    childInjector.destroy();

    await expect(removeCall).rejects.toMatchObject({ name: 'AbortError', message: 'NotStarted' });
    writes.resolve('rename-1');
    await renameCall;
    await nextTask();
    expect(writes.started).toEqual(['rename-1', 'rename-2']);
    writes.resolve('rename-2');
    await expect(nextRename).resolves.toBe('rename-2-done');
  });

  it("keeps another mutation's call behind an aborted call whose mutationFn ignores its AbortSignal", async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });
    const remove = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: queue });

    void rename.mutate('rename');
    const removeCall = remove.mutate('remove');
    await nextTask();
    rename.reset();
    await nextTask();
    expect(writes.started).toEqual(['rename']);

    writes.resolve('rename');
    await nextTask();
    expect(writes.started).toEqual(['rename', 'remove']);
    writes.resolve('remove');
    await expect(removeCall).resolves.toBe('remove-done');
  });

  it("doesn't link two mutations that each use concurrency: 'queue'", async () => {
    const writes = manualWrites();
    const rename = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: 'queue' });
    const remove = createMutation<string, string>({ mutationFn: writes.mutationFn, concurrency: 'queue' });

    void rename.mutate('rename');
    void remove.mutate('remove');
    await nextTask();

    expect(writes.started).toEqual(['rename', 'remove']);
  });
});

describe('mutationQueue() with a key', () => {
  interface Draft {
    docId: string;
    content: string;
  }
  const byDoc = (draft: Draft) => draft.docId;
  const label = (draft: Draft) => `${draft.docId}:${draft.content}`;

  it('runs calls with different keys at once', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const save = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(label(draft)),
      concurrency: { queue, key: byDoc },
    });

    void save.mutate({ docId: 'A', content: '1' });
    void save.mutate({ docId: 'B', content: '1' });
    await nextTask();

    expect(writes.started).toEqual(['A:1', 'B:1']);
  });

  it('runs calls with the same key one at a time, in call order, across mutations', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const save = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(label(draft)),
      concurrency: { queue, key: byDoc },
    });
    const archive = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(`archive ${label(draft)}`),
      concurrency: { queue, key: byDoc },
    });

    const firstSave = save.mutate({ docId: 'A', content: '1' });
    void archive.mutate({ docId: 'A', content: '1' });
    void save.mutate({ docId: 'B', content: '1' });
    await nextTask();
    expect(writes.started).toEqual(['A:1', 'B:1']);

    writes.resolve('A:1');
    await firstSave;
    await nextTask();
    expect(writes.started).toEqual(['A:1', 'B:1', 'archive A:1']);
  });

  it('forgets a key once its calls have settled', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const save = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(label(draft)),
      concurrency: { queue, key: byDoc },
    });

    const firstSave = save.mutate({ docId: 'A', content: '1' });
    const secondSave = save.mutate({ docId: 'A', content: '2' });
    await nextTask();
    expect(writeQueueOf(queue).tails.size).toBe(1);

    writes.resolve('A:1');
    await firstSave;
    await nextTask();
    writes.resolve('A:2');
    await secondSave;
    await nextTask();

    expect(writeQueueOf(queue).tails.size).toBe(0);
  });

  it('runs a call without a key once the calls of every key ahead of it have settled', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const save = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(label(draft)),
      concurrency: { queue, key: byDoc },
    });
    const removeAll = createMutation<void, string>({ mutationFn: () => writes.mutationFn('remove all'), concurrency: queue });

    const saveA = save.mutate({ docId: 'A', content: '1' });
    const saveB = save.mutate({ docId: 'B', content: '1' });
    const removeAllCall = removeAll.mutate();
    await nextTask();
    expect(writes.started).toEqual(['A:1', 'B:1']);

    writes.resolve('A:1');
    await saveA;
    await nextTask();
    expect(writes.started).toEqual(['A:1', 'B:1']);

    writes.resolve('B:1');
    await saveB;
    await nextTask();
    expect(writes.started).toEqual(['A:1', 'B:1', 'remove all']);
    writes.resolve('remove all');
    await expect(removeAllCall).resolves.toBe('remove all-done');
  });

  it('runs the keyed calls made after a call without a key once it has settled, other keys still at once', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const save = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(label(draft)),
      concurrency: { queue, key: byDoc },
    });
    const removeAll = createMutation<void, string>({ mutationFn: () => writes.mutationFn('remove all'), concurrency: queue });

    const removeAllCall = removeAll.mutate();
    void save.mutate({ docId: 'A', content: '2' });
    void save.mutate({ docId: 'B', content: '2' });
    await nextTask();
    expect(writes.started).toEqual(['remove all']);

    writes.resolve('remove all');
    await removeAllCall;
    await nextTask();
    expect(writes.started).toEqual(['remove all', 'A:2', 'B:2']);
  });

  it('forgets a call without a key once it has settled', async () => {
    const queue = mutationQueue();
    const writes = manualWrites();
    const save = createMutation<Draft, string>({
      mutationFn: (draft) => writes.mutationFn(label(draft)),
      concurrency: { queue, key: byDoc },
    });
    const removeAll = createMutation<void, string>({ mutationFn: () => writes.mutationFn('remove all'), concurrency: queue });

    const saveA = save.mutate({ docId: 'A', content: '1' });
    const removeAllCall = removeAll.mutate();
    await nextTask();
    writes.resolve('A:1');
    await saveA;
    await nextTask();
    writes.resolve('remove all');
    await removeAllCall;
    await nextTask();

    expect(writeQueueOf(queue).tails.size).toBe(0);
  });

  it("types the key's argument as the mutation's input", () => {
    const queue = mutationQueue();

    createMutation<Draft, string>({
      mutationFn: () => Promise.resolve('ok'),
      concurrency: {
        queue,
        key: (draft) => {
          expectTypeOf(draft).toEqualTypeOf<Draft>();
          return draft.docId;
        },
      },
    });
    createMutation<Draft, string>({
      mutationFn: () => Promise.resolve('ok'),
      // @ts-expect-error a key is a string or a number
      concurrency: { queue, key: (draft) => draft },
    });
  });
});

describe('mutationQueue() properties', () => {
  type Kind = 'save' | 'archive' | 'removeAll';
  type Step =
    | { type: 'mutate'; kind: Kind; docId: 'A' | 'B'; succeeds: boolean }
    | { type: 'reset'; kind: Kind }
    | { type: 'settleOne' };

  interface Call {
    id: number;
    kind: Kind;
    docId: 'A' | 'B';
    succeeds: boolean;
    startedAt?: number;
    endedAt?: number;
    abortedAs?: 'NotStarted' | 'Aborted';
  }

  const kindArb = fc.constantFrom<Kind>('save', 'archive', 'removeAll');
  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    {
      arbitrary: fc.record({
        type: fc.constant('mutate' as const),
        kind: kindArb,
        docId: fc.constantFrom('A' as const, 'B' as const),
        succeeds: fc.boolean(),
      }),
      weight: 4,
    },
    { arbitrary: fc.record({ type: fc.constant('reset' as const), kind: kindArb }), weight: 1 },
    { arbitrary: fc.constant({ type: 'settleOne' as const }), weight: 3 },
  );

  // 'removeAll' has no key: it orders against every call.
  const conflict = (earlier: Call, later: Call) =>
    earlier.kind === 'removeAll' || later.kind === 'removeAll' || earlier.docId === later.docId;

  it('keeps conflicting calls in call order, starts every call not reset while queued, and settles each as expected', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.array(stepArb, { minLength: 1, maxLength: 12 }), async (scheduler, steps) => {
        const queue = mutationQueue();
        const calls: Call[] = [];
        const outcomes: Promise<number>[] = [];
        let clock = 0;

        // Ignores its AbortSignal, so an aborted call in flight still holds the queue.
        const mutationFn = async (call: Call) => {
          call.startedAt = clock++;
          await scheduler.schedule(Promise.resolve());
          call.endedAt = clock++;
          if (!call.succeeds) throw new Error(`failed ${call.id}`);
          return call.id;
        };
        const mutations: Record<Kind, MutationRef<Call, number>> = {
          save: createMutation<Call, number>({ mutationFn, concurrency: { queue, key: (call) => call.docId } }),
          archive: createMutation<Call, number>({ mutationFn, concurrency: { queue, key: (call) => call.docId } }),
          removeAll: createMutation<Call, number>({ mutationFn, concurrency: queue }),
        };

        for (const step of steps) {
          if (step.type === 'mutate') {
            const call: Call = { id: calls.length, kind: step.kind, docId: step.docId, succeeds: step.succeeds };
            calls.push(call);
            outcomes.push(mutations[step.kind].mutate(call));
          } else if (step.type === 'reset') {
            for (const call of calls) {
              if (call.kind === step.kind && call.abortedAs === undefined && call.endedAt === undefined) {
                call.abortedAs = call.startedAt === undefined ? 'NotStarted' : 'Aborted';
              }
            }
            mutations[step.kind].reset();
          } else {
            if (scheduler.count() > 0) await scheduler.waitOne();
            await nextTask();
          }
        }
        const results = await scheduler.waitFor(Promise.allSettled(outcomes));
        await scheduler.waitIdle();

        const overlaps = calls.flatMap((later) =>
          calls
            .slice(0, later.id)
            .filter((earlier) => conflict(earlier, later) && earlier.startedAt !== undefined && later.startedAt !== undefined)
            .filter((earlier) => (later.startedAt ?? 0) < (earlier.endedAt ?? Infinity))
            .map((earlier) => [earlier.id, later.id]),
        );
        expect(overlaps).toEqual([]);

        const startedWrongly = calls.filter((call) => (call.startedAt === undefined) !== (call.abortedAs === 'NotStarted'));
        expect(startedWrongly).toEqual([]);

        const settledAs = results.map((result) =>
          result.status === 'fulfilled' ? result.value : `${(result.reason as Error).name}: ${(result.reason as Error).message}`,
        );
        const expected = calls.map((call) => {
          if (call.abortedAs) return `AbortError: ${call.abortedAs}`;
          return call.succeeds ? call.id : `Error: failed ${call.id}`;
        });
        expect(settledAs).toEqual(expected);
      }),
    );
  });
});

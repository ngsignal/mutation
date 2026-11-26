import { signal } from '@angular/core';
import { Observable } from 'rxjs';
import { createActivityLog } from './activity-log';

export interface User {
  id: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: 'invalid-name' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Resolves with `value` after `ms`, or rejects with the abort reason as soon as `abortSignal` aborts, like `fetch()`. */
export function delay<T>(value: T, ms: number, abortSignal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(abortSignal.reason);
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', abort);
      resolve(value);
    }, ms);
    if (abortSignal.aborted) {
      abort();
      return;
    }
    abortSignal.addEventListener('abort', abort, { once: true });
  });
}

/** What a fake server received, and how each request ended, for pages to display. */
function createRequestLog() {
  const log = createActivityLog();
  return {
    entries: log.entries,
    async track<T>(label: string, abortSignal: AbortSignal, handle: () => Promise<T>): Promise<T> {
      log.add(`${label} received`);
      try {
        const response = await handle();
        log.add(`${label} done`);
        return response;
      } catch (error) {
        log.add(abortSignal.aborted ? `${label} aborted by the client` : `${label} failed`);
        throw error;
      }
    },
  };
}

/**
 * An in-memory user API, one per page so pages don't affect each other. An empty name is
 * rejected, a rename takes 2 s, and deleting "Grace Hopper" always fails.
 */
export function createFakeUserServer() {
  const requests = createRequestLog();
  const failNextCall = signal(false);
  let users: User[] = [
    { id: '1', name: 'Ada Lovelace' },
    { id: '2', name: 'Grace Hopper' },
  ];
  let nextId = 3;

  return {
    requests: requests.entries,
    /** When set, the next createUser fails with an `'unavailable'` error, then it resets. */
    failNextCall,
    initialUsers: (): User[] => [...users],

    fetchUsers: (abortSignal: AbortSignal): Promise<User[]> =>
      requests.track('fetchUsers()', abortSignal, async () => [
        ...(await delay(users, 800, abortSignal)),
      ]),

    createUser: (name: string, abortSignal: AbortSignal): Promise<User> =>
      requests.track(`createUser("${name}")`, abortSignal, async () => {
        if (name.trim().length === 0) {
          throw new ApiError('invalid-name', 'Name must not be empty');
        }
        const unavailable = failNextCall();
        failNextCall.set(false);
        const user = await delay({ id: String(nextId++), name }, 2000, abortSignal);
        if (unavailable) {
          throw new ApiError('unavailable', 'Service unavailable, try again');
        }
        users = [...users, user];
        return user;
      }),

    renameUser: (user: User, abortSignal: AbortSignal): Promise<User> =>
      requests.track(`renameUser("${user.name}")`, abortSignal, async () => {
        if (user.name.trim().length === 0) {
          throw new ApiError('invalid-name', 'Name must not be empty');
        }
        await delay(undefined, 2000, abortSignal);
        users = users.map((u) => (u.id === user.id ? user : u));
        return user;
      }),

    deleteUser: (user: User, abortSignal: AbortSignal): Promise<void> =>
      requests.track(`deleteUser("${user.name}")`, abortSignal, async () => {
        await delay(undefined, 2000, abortSignal);
        if (user.name === 'Grace Hopper') {
          throw new Error(`Server refused to delete ${user.name}`);
        }
        users = users.filter((u) => u.id !== user.id);
      }),
  };
}

/** "Charlie" answers slower than the others, so moving it then another item races two requests. */
export function createFakeReorderServer() {
  const requests = createRequestLog();
  const items = ['Alpha', 'Bravo', 'Charlie'];
  const order = signal(items);

  return {
    requests: requests.entries,
    items,
    order: order.asReadonly(),

    moveToTop: (item: string, abortSignal: AbortSignal): Promise<string[]> =>
      requests.track(`moveToTop("${item}")`, abortSignal, async () => {
        await delay(undefined, item === 'Charlie' ? 1200 : 300, abortSignal);
        order.update((current) => [item, ...current.filter((other) => other !== item)]);
        return order();
      }),
  };
}

/** Takes 1.5 s to record a charge, leaving time for a second click. */
export function createFakePaymentServer() {
  const requests = createRequestLog();
  const charges = signal(0);

  return {
    requests: requests.entries,
    charges: charges.asReadonly(),

    charge: (abortSignal: AbortSignal): Promise<void> =>
      requests.track('charge()', abortSignal, async () => {
        await delay(undefined, 1500, abortSignal);
        charges.update((count) => count + 1);
      }),
  };
}

/** One todo. A rename takes 1.2 s and fails with a 404 if the todo is gone by then; a delete takes 0.3 s. */
export function createFakeTodoServer() {
  const requests = createRequestLog();
  const title = signal<string | undefined>('Buy milk');

  return {
    requests: requests.entries,
    /** `undefined` once deleted. */
    title: title.asReadonly(),

    rename: (newTitle: string, abortSignal: AbortSignal): Promise<string> =>
      requests.track(`PATCH /todos/1 "${newTitle}"`, abortSignal, async () => {
        await delay(undefined, 1200, abortSignal);
        if (title() === undefined) {
          throw new Error('404: todo not found');
        }
        title.set(newTitle);
        return newTitle;
      }),

    remove: (abortSignal: AbortSignal): Promise<void> =>
      requests.track('DELETE /todos/1', abortSignal, async () => {
        await delay(undefined, 300, abortSignal);
        title.set(undefined);
      }),
  };
}

export interface Draft {
  docId: 'A' | 'B';
  content: string;
}

/** Two documents. Saving A takes 1.5 s, saving B or deleting them all 0.3 s. A save creates a deleted document again. */
export function createFakeDocumentServer() {
  const requests = createRequestLog();
  const documents = signal<Partial<Record<Draft['docId'], string>>>({ A: 'draft', B: 'draft' });

  return {
    requests: requests.entries,
    documents: documents.asReadonly(),

    save: ({ docId, content }: Draft, abortSignal: AbortSignal): Promise<void> =>
      requests.track(`PUT /docs/${docId} "${content}"`, abortSignal, async () => {
        await delay(undefined, docId === 'A' ? 1500 : 300, abortSignal);
        documents.update((current) => ({ ...current, [docId]: content }));
      }),

    removeAll: (abortSignal: AbortSignal): Promise<void> =>
      requests.track('DELETE /docs', abortSignal, async () => {
        await delay(undefined, 300, abortSignal);
        documents.set({});
      }),
  };
}

/** Exposes a fake call the way `HttpClient` does: a cold Observable, aborted on unsubscribe. */
function asObservable<T>(call: (abortSignal: AbortSignal) => Promise<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    const controller = new AbortController();
    call(controller.signal).then(
      (value) => {
        subscriber.next(value);
        subscriber.complete();
      },
      (error: unknown) => subscriber.error(error),
    );
    return () => controller.abort();
  });
}

export interface Profile {
  name: string;
}

/** Saves a display name in 1.5 s; an empty name is rejected. Observable-based, like `HttpClient`. */
export function createFakeProfileServer() {
  const requests = createRequestLog();

  return {
    requests: requests.entries,

    saveProfile: (name: string): Observable<Profile> =>
      asObservable((abortSignal) =>
        requests.track(`saveProfile("${name}")`, abortSignal, async () => {
          if (name.trim().length === 0) {
            throw new ApiError('invalid-name', 'Name must not be empty');
          }
          return delay({ name }, 1500, abortSignal);
        }),
      ),
  };
}

/**
 * Takes 4 s to lock a seat, long enough to start several locks at once; seat 6 is always
 * refused. Observable-based, like `HttpClient`.
 */
export function createFakeSeatServer() {
  const requests = createRequestLog();
  const delayMs = 4000;
  const takenSeat = 6;

  return {
    requests: requests.entries,
    seats: [1, 2, 3, 4, 5, 6],
    takenSeat,
    delaySeconds: delayMs / 1000,

    lockSeat: (seat: number): Observable<number> =>
      asObservable((abortSignal) =>
        requests.track(`lockSeat(${seat})`, abortSignal, async () => {
          await delay(undefined, delayMs, abortSignal);
          if (seat === takenSeat) {
            throw new Error(`Seat ${seat} is already taken`);
          }
          return seat;
        }),
      ),
  };
}

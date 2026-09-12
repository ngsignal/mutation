# @ngsignal/mutation

[![CI](https://github.com/ngsignal/mutation/actions/workflows/ci.yml/badge.svg)](https://github.com/ngsignal/mutation/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ngsignal/mutation/actions/workflows/codeql.yml/badge.svg)](https://github.com/ngsignal/mutation/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/%40ngsignal%2Fmutation.svg)](https://www.npmjs.com/package/@ngsignal/mutation)
[![license](https://img.shields.io/npm/l/%40ngsignal%2Fmutation.svg)](./LICENSE)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ngsignal/mutation/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ngsignal/mutation)

An Angular low-level Signal based primitive for mutations (POST/PUT/DELETE).

[Live demo on StackBlitz](https://stackblitz.com/~/github.com/ErwanRaulo/ng-mutation-demo)

## Why

Angular provides `resource()` and `httpResource()` for reactive fetching,
but explicitly not for mutations:

> "resource is intended for _read_ operations, not operations which perform
> mutations. resource will cancel in-progress loads via the AbortSignal
> when destroyed or when a new request object becomes available, which
> could prematurely abort mutations."
> [Angular API reference](https://angular.dev/api/core/resource)

Today, handling a POST/PUT/DELETE means either manually overloading
`httpResource`, or hand-rolling the write in a service.


## Installation

```bash
npm install @ngsignal/mutation
```

## Features

### Automatic cancellation of stale mutations

Calling `mutate()` again while one is already in flight aborts the previous call's `AbortSignal` and ignores its result if it resolves anyway, so only the last call's outcome ever reaches `status`/`value`.

### callbacks: onSuccess / onError 

```ts
const createTodo = mutation<string, Todo>({
  mutationFn: (title, signal) => api.createTodo(title, signal),
  onSuccess: (todo) => this.todos.update((list) => [...list, todo]),
  onError: (err) => this.toast.show(String(err)),
});
```

Run side effects (cache updates, navigation, toasts) right where the mutation
is declared, in addition to `await mutate(...)` at the call site.

### Reset

Brings `status`/`value`/`error` back to their initial state and aborts an in-flight call, if any.

### SSR support

Every in-flight mutation registers itself with Angular's `PendingTasks`, so
`ApplicationRef.isStable` (and SSR rendering) waits for it and releases it 
immediately if superseded or reset, rather than waiting for the stale call to actually settle.

### Custom injector

Pass `injector` to call `mutation()` outside of an injection context (e.g.
factory functions).

## Working with resource

`mutation()` has no cache and won't touch a `resource()`/`httpResource()` for you. Two common patterns:

### Refreshing a resource after a mutation

```ts
readonly usersResource = resource({
  loader: ({ abortSignal }) => this.api.fetchUsers(abortSignal),
});

readonly createUser = mutation<string, User>({
  mutationFn: (name, signal) => this.api.createUser(name, signal),
  onSuccess: () => this.usersResource.reload(),
});
```

Use `onSuccess` (or an `effect()` on `status()`), not `.then()` on `mutate()`. The returned
promise settles even for a call that [automatic
cancellation](#automatic-cancellation-of-stale-mutations) already discarded, so it resolves with the
real value or `undefined` (never rejects) if `mutationFn` fails.

### Optimistic updates

`resource().value` is a `WritableSignal`: update it immediately, roll back in `.catch()`
(`mutate()` rejects like `mutationFn` does, as long as this call hasn't been
[superseded](#refreshing-a-resource-after-a-mutation) by a newer one):

```ts
readonly deleteUser = mutation<string, void>({
  mutationFn: (id, signal) => this.api.deleteUser(id, signal),
});

removeUser(id: string) {
  const previous = this.usersResource.value();
  this.usersResource.update((users) => users.filter((u) => u.id !== id));

  this.deleteUser.mutate(id).catch(() => this.usersResource.set(previous));
}
```

`deleteUser` is one shared instance, so two `removeUser` calls in a row cancel the first delete
(same [automatic cancellation](#automatic-cancellation-of-stale-mutations)). For independent
concurrent operations, use one `mutation()` per operation instead.

## Using HttpClient

`mutationFn` expects `(input, abortSignal) => Promise<TOutput>` while `HttpClient` returns an
`Observable`. Bridge the two by subscribing manually and wiring the abort signal to
`unsubscribe()`, so cancellation still works:

```ts
function fromHttp<T>(source: Observable<T>, abortSignal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const sub = source.subscribe({ next: resolve, error: reject });
    abortSignal.addEventListener('abort', () => {
      sub.unsubscribe();
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

readonly createUser = mutation<string, User>({
  mutationFn: (name, signal) => fromHttp(this.http.post<User>('/api/users', { name }), signal),
});
```

## API

### Options

- `mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>`
- `onSuccess?: (output: TOutput, input: TInput) => void`
- `onError?: (error: unknown, input: TInput) => void`
- `injector?: Injector`

### Return value

- `status: Signal<'idle' | 'pending' | 'success' | 'error'>`
- `value: Signal<TOutput | undefined>` keeps the last successful result when a later call fails; only `reset()` or a subsequent success clears it
- `error: Signal<unknown>`
- `isPending: Signal<boolean>`
- `mutate(input: TInput): Promise<TOutput | undefined>` resolves to `undefined` if the call was superseded before it settled
- `reset(): void`

## Design choices

Directly inspired by the internal structure of `resource.ts` in Angular
core: raw writable signals, a generation counter to ignore responses from
stale requests, `PendingTasks` for SSR stability, and cleanup via
`DestroyRef` if the context is destroyed while a mutation is in flight.

## Why not TanStack Query?

[`@tanstack/angular-query-experimental`](https://www.npmjs.com/package/@tanstack/angular-query-experimental)
already ships `injectMutation`, and is a mature choice if you want it. Different tradeoffs:

- **Scope**: it's a full cache/data-sync layer (queries, infinite queries, devtools,
  persistence) built on `@tanstack/query-core`, where mutations are one feature among many.
- **Setup**: `injectMutation` needs a `QueryClient` provided app-wide, even for a single
  mutation and zero queries while `mutation()` needs only an injection context.
- **Cancellation**: TanStack's `MutationFunctionContext` carries no `AbortSignal` so mutations
  aren't auto-cancelled when superseded while `mutation()` gives that for free, the same way
  `resource()` does for reads.

Reach for TanStack if you want retries, offline support, or cross-component cache invalidation.
Reach for this if you want the smallest primitive that behaves like `resource()`'s write-side
counterpart.

## Status

Experimental project.
Filling a gap while waiting for a possible official API. Real-world usage feedback is welcome, especially to help inform the official RFC discussion on the evolution of Resources in Angular.

## Contributing

Issues and PRs are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

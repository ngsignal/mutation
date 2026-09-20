<div align="center">

<img src="./mutation-icon.svg" alt="@ngsignal/mutation" width="120" height="120">

# @ngsignal/mutation

[![CI](https://github.com/ngsignal/mutation/actions/workflows/ci.yml/badge.svg)](https://github.com/ngsignal/mutation/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ngsignal/mutation/actions/workflows/codeql.yml/badge.svg)](https://github.com/ngsignal/mutation/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/%40ngsignal%2Fmutation.svg)](https://www.npmjs.com/package/@ngsignal/mutation)
[![license](https://img.shields.io/npm/l/%40ngsignal%2Fmutation.svg)](./LICENSE)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ngsignal/mutation/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ngsignal/mutation)

An Angular low-level Signal-based primitive for mutations (POST/PUT/DELETE).

[Live demo on StackBlitz](https://stackblitz.com/~/github.com/ErwanRaulo/ng-mutation-demo)

</div>

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

</br>


## How to install

```bash
npm install @ngsignal/mutation
```
</br>


## Features

### Stale-response guarding

Calling `mutate()` again while one is already in flight does **not** abort the previous call, a write may already have reached the server and be unsafe to cancel there, so both calls run to
completion independently. Only the last call's outcome is committed to `status`/`value`/`error`;

### concurrency: 'queue'

```ts
const reorderItem = mutation<Reorder, void>({
  concurrency: 'queue',
  mutationFn: (reorder, signal) => api.reorder(reorder, signal),
});
```

`concurrency: 'queue'` runs `mutationFn` calls one at a time, in submission order: the next
call only starts once the previous one has settled. `status`/`value`/`error`/`input` still only
reflect the most recently submitted call.

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

### onSettled

```ts
const createTodo = mutation<string, Todo>({
  mutationFn: (title, signal) => api.createTodo(title, signal),
  onSettled: () => this.isModalOpen.set(false),
});
```

Runs after `onSuccess` or `onError`, whichever fired. Use it for cleanup that must happen either way (closing a modal, releasing a UI lock).

### input

`input()` holds the input of the most recent `mutate()` call, from the moment it's called
until the next `mutate()` or `reset()`. Useful for rendering the in-flight or failed input
without the caller having to store it separately".

### Reset

Brings `status`/`value`/`error`/`input` back to their initial state and aborts any in-flight
call(s).

### SSR support

Every in-flight mutation registers itself with Angular's `PendingTasks`, so
`ApplicationRef.isStable` (and SSR rendering) waits for it and releases it
immediately on reset/destroy, rather than waiting for a stale call to actually settle.

### Custom injector

Pass `injector` to call `mutation()` outside of an injection context (e.g.
factory functions).

### snapshot

`status`/`value`/`error` are three separate signals, so TypeScript can't narrow `value()` from
`status()` alone. `snapshot()` bundles them into one discriminated-union read for exhaustive
`@switch`/`switch` handling:

```ts
@switch (createInvoice.snapshot(); as snap) {
  @case ('success') { {{ snap.value.id }} }
  @case ('error') { {{ snap.error }} }
}
```

`value` stays populated on `'pending'`/`'error'` too, since `mutation()` keeps the last known
value across those states (see [stale-response guarding](#stale-response-guarding)).

### hasValue guard

`value()` is undefined since nothing has been created before the first
successful `mutate()`. `hasValue()` narrows it, so you can act on the
result safely.

```ts
const createInvoice = mutation<Order, Invoice>({
  mutationFn: (order, signal) => api.createInvoice(order, signal),
});

if (createInvoice.hasValue()) {
  downloadPdf(createInvoice.value());
}
```

</br>

## Working with resource

`mutation()` has no cache and won't touch a `resource()`/`httpResource()` for you.
See [docs/RECIPES.md](./docs/RECIPES.md) for refreshing a resource after a mutation,
optimistic updates, and bridging `HttpClient`'s `Observable` to the `Promise`-based
`mutationFn`.

## API

### Options

`mutation<TInput, TOutput, TError = unknown>(options)`

- `mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>`
- `onSuccess?: (output: TOutput, input: TInput) => void`
- `onError?: (error: TError, input: TInput) => void`
- `onSettled?: (output: TOutput | undefined, error: TError | undefined, input: TInput) => void`
- `concurrency?: 'queue'`
- `injector?: Injector`

### Return value

- `status: Signal<'idle' | 'pending' | 'success' | 'error'>`
- `value: Signal<TOutput | undefined>`
- `error: Signal<TError | undefined>`
- `input: Signal<TInput | undefined>`
- `isPending: Signal<boolean>`
- `snapshot: Signal<MutationSnapshot<TOutput>>`.
- `hasValue(): boolean`.
- `isIdle: Signal<boolean>` / `isSuccess: Signal<boolean>` / `isError: Signal<boolean>`
- `mutate(input: TInput): Promise<TOutput>`
- `reset(): void`

</br>

## Design choices

Directly inspired by the internal structure of `resource.ts` in Angular core. See
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the implementation rationale and a
comparison with `@tanstack/angular-query-experimental`.

</br>

## Status & Stability

Experimental (`0.x`): minor releases may include breaking changes, called out in the
[CHANGELOG.md](./CHANGELOG.md). Pin an exact version to avoid surprises.

</br>

## Contributing

Issues and PRs are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md).

</br>

## License

MIT

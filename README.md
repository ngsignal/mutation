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

Brings `status`/`value`/`error` back to their initial state and aborts any in-flight call(s).

### SSR support

Every in-flight mutation registers itself with Angular's `PendingTasks`, so
`ApplicationRef.isStable` (and SSR rendering) waits for it and releases it
immediately on reset/destroy, rather than waiting for a stale call to actually settle.

### Custom injector

Pass `injector` to call `mutation()` outside of an injection context (e.g.
factory functions).

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

- `mutationFn: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>`
- `onSuccess?: (output: TOutput, input: TInput) => void`
- `onError?: (error: unknown, input: TInput) => void`
- `injector?: Injector`

### Return value

- `status: Signal<'idle' | 'pending' | 'success' | 'error'>`
- `value: Signal<TOutput | undefined>`
- `error: Signal<unknown>`
- `isPending: Signal<boolean>`
- `hasValue(): boolean` — type-guard narrowing `value` from `TOutput | undefined` to `TOutput`.
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

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

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Features](#features)
- [Working with resource](#working-with-resource)
- [API](#api)
- [Design choices](#design-choices)
- [Status & Stability](#status--stability)
- [Contributing](#contributing)

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
 
## Install
 
```bash
npm install @ngsignal/mutation
```
 
Requires Angular `^21.0.0` or `^22.0.0` (peer dependency).
 
## Quick start
 
```ts
import { Component, inject } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
 
@Component({
  selector: 'app-todo',
  template: `
    <input #title />
 
    <button (click)="addTodo(title.value)" [disabled]="createTodo.isPending()">
      {{ createTodo.isPending() ? 'Saving…' : 'Add' }}
    </button>
 
    @if (createTodo.error(); as error) {
      <p role="alert">{{ error }}</p>
    }
  `,
})
export class NewTodoComponent {
  private readonly api = inject(TodoApi);
 
  readonly createTodo = mutation<string, Todo>({
    mutationFn: (title, abortSignal) => this.api.createTodo(title, abortSignal),
  });
 
  addTodo(title: string): void {
    this.createTodo.mutate(title);
  }
}
```
 
Using `HttpClient`? `mutationFn` takes a `Promise`, see
[bridging an Observable](./docs/RECIPES.md#using-httpclient).
 
## Features
 
### Stale-response guarding
 
Calling `mutate()` again while one is already in flight does **not** abort the previous call, a
write may already have reached the server and be unsafe to cancel there, so both calls run to
completion independently. Only the last call's outcome is committed to `status`/`value`/`error`.
 
### Callbacks: onSuccess / onError
 
Run side effects (cache updates, navigation, toasts) right where the mutation is declared, in
addition to `await mutate(...)` at the call site.
 
```ts
const createTodo = mutation<string, Todo>({
  mutationFn: (title, signal) => api.createTodo(title, signal),
  onSuccess: (todo) => this.todos.update((list) => [...list, todo]),
  onError: (err) => this.toast.show(String(err)),
});
```
 
### snapshot
 
`status`/`value`/`error` are three separate signals, so TypeScript can't narrow `value()` from
`status()` alone. `snapshot()` bundles them into one discriminated-union read for exhaustive
`@switch`/`switch` handling:
 
```ts
@let snap = createInvoice.snapshot();
@switch (snap.status) {
  @case ('success') { {{ snap.value.id }} }
  @case ('error') { {{ snap.error }} }
  @default { Idle or pending… }
}
```
 
`value` stays populated on `'pending'`/`'error'` too, since `mutation()` keeps the last known
value across those states (see [stale-response guarding](#stale-response-guarding)).
 
### hasValue guard
 
`value()` is undefined since nothing has been created before the first successful `mutate()`.
`hasValue()` narrows it, so you can act on the result safely.
 
```ts
const createInvoice = mutation<Order, Invoice>({
  mutationFn: (order, signal) => api.createInvoice(order, signal),
});
 
if (createInvoice.hasValue()) {
  downloadPdf(createInvoice.value());
}
```
 
### Also included
 
- **`reset()`** brings `status`/`value`/`error`/`input` back to their initial state and aborts
  any in-flight call(s).
- **`onSettled`** runs after `onSuccess` or `onError`, whichever fired; use it for cleanup that
  must happen either way (closing a modal, releasing a UI lock).
- **`input`** holds the input of the most recent `mutate()` call, from the moment it's called
  until the next `mutate()` or `reset()`.
- **`concurrency: 'queue'`** runs `mutationFn` calls one at a time, in submission order, instead
  of letting them run concurrently; `status`/`value`/`error`/`input` still only reflect the most
  recently submitted call.
- **`concurrency: 'drop'`** ignores `mutate()` while a call is already in flight to guards against double-submits. 
  A dropped call never runs `mutationFn`, leaves the signals untouched, and its promise rejects with a
  `DOMException` whose message is `'Dropped'`.
- **`isIdle` / `isSuccess` / `isError`**: convenience signals alongside `isPending`, one per
  `status()` value.
- **SSR support**: every in-flight mutation registers with Angular's `PendingTasks`, so
  `ApplicationRef.isStable` (and SSR rendering) waits for it, and releases it immediately on
  reset/destroy rather than waiting for a stale call to settle.
- **Custom injector**: pass `injector` to call `mutation()` outside of an injection context
  (e.g. factory functions).
 
## Working with resource
 
`mutation()` has no cache and won't touch a `resource()`/`httpResource()` for you. See
[docs/RECIPES.md](./docs/RECIPES.md):
 
- [Refreshing a resource after a mutation](./docs/RECIPES.md#refreshing-a-resource-after-a-mutation)
- [Optimistic updates with rollback](./docs/RECIPES.md#optimistic-updates)
- [Using `HttpClient`](./docs/RECIPES.md#using-httpclient)
 
## API
 
`mutation<TInput, TOutput, TError = unknown>(options)`
 
`TError` types `error()`/`onError`/`onSettled`; omit it and they stay `unknown`.
 
### Options
 
| Option        | Type                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| `mutationFn`  | `(input: TInput, abortSignal: AbortSignal) => Promise<TOutput>`                |
| `onSuccess?`  | `(output: TOutput, input: TInput) => void`                                     |
| `onError?`    | `(error: TError, input: TInput) => void`                                       |
| `onSettled?`  | `(output: TOutput \| undefined, error: TError \| undefined, input: TInput) => void` |
| `concurrency?`| `'queue' \| 'drop'`                                                            |
| `injector?`   | `Injector`                                                                      |
 
### Return value
 
| Member                              | Type                                                  | Notes                                                       |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `status`                            | `Signal<'idle' \| 'pending' \| 'success' \| 'error'>` |                                                             |
| `value`                             | `Signal<TOutput \| undefined>`                        | Kept across `'pending'`/`'error'`                           |
| `error`                             | `Signal<TError \| undefined>`                         |                                                             |
| `input`                             | `Signal<TInput \| undefined>`                         | Input of the most recent `mutate()` call                    |
| `isPending`                         | `Signal<boolean>`                                     |                                                             |
| `isIdle` / `isSuccess` / `isError`  | `Signal<boolean>`                                     | One per `status()` value                                    |
| `snapshot`                          | `Signal<MutationSnapshot<TOutput>>`                   | Discriminated union of `status`/`value`/`error`              |
| `hasValue`                          | `() => boolean`                                       | Type guard narrowing `value` to `TOutput`                    |
| `mutate`                            | `(input: TInput) => Promise<TOutput>`                 | Rejects like `mutationFn` does, for that specific call; safe to ignore (no unhandled rejection) |
| `reset`                             | `() => void`                                          |                                                             |
 
## Design choices
 
Directly inspired by the internal structure of `resource.ts` in Angular core. See
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the implementation rationale and a
comparison with `@tanstack/angular-query-experimental`.
 
## Status & Stability
 
Experimental (`0.x`): minor releases may include breaking changes, called out in the
[CHANGELOG.md](./CHANGELOG.md). Pin an exact version to avoid surprises.
 
## Contributing
 
Issues and PRs are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md).
 
## License
 
MIT
 
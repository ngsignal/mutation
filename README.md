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
- `value: Signal<TOutput | undefined>` keeps the last successful result when a later call fails; only `reset()` or a subsequent success clears it
- `error: Signal<unknown>`
- `isPending: Signal<boolean>`
- `mutate(input: TInput): Promise<TOutput | undefined>` resolves to `undefined` if the call was superseded before it settled
- `reset(): void`

## Design choices

Directly inspired by the internal structure of `resource.ts` in Angular core. See
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the implementation rationale and a
comparison with `@tanstack/angular-query-experimental`.

## Status & Stability

Experimental project, filling a gap while waiting for a possible official API. Real-world
usage feedback is welcome, especially to help inform the official RFC discussion on the
evolution of Resources in Angular.

Versioning follows [semver](https://semver.org/), with the `0.x` allowance it defines for
initial development:

- **Patch releases (`0.1.x`)** are always backward compatible: bug fixes only.
- **Minor releases (`0.x.0`)** may include breaking changes to the public API
  (`mutation()` options, return signals, exported types) while the major stays `0`. Any
  breaking change is called out at the top of the relevant [CHANGELOG.md](./CHANGELOG.md)
  entry.
- **`1.0.0`** will land once the API has settled through real-world usage (or the Angular
  RFC above lands), at which point breaking changes require a major bump like any other
  semver-following package.

Until then, pin an exact version or a `0.1.x` range if you want to avoid absorbing
behavioral changes on `npm install`.

## Contributing

Issues and PRs are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

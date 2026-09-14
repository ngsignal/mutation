# Architecture

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
- **Cancellation**: neither auto-cancels a mutation when superseded, a write may already have
  reached the server and be unsafe to cancel there, unlike a read. `mutation()` still hands
  `mutationFn` an `AbortSignal`, but only aborts it on explicit reset or destroy.

Reach for TanStack if you want retries, offline support, or cross-component cache invalidation.
Reach for this if you want the smallest primitive that behaves like `resource()`'s write-side
counterpart.

# Architecture

## Design choices

Directly inspired by the internal structure of `resource.ts` in Angular
core: one writable state signal, tracking of the latest call to ignore responses from
stale requests, `PendingTasks` for SSR stability, and cleanup via
`DestroyRef` if the context is destroyed while a mutation is in flight.

Tracking the latest call only guards the signals. Callbacks run for every call that settles,
superseded or not, because a superseded write still happened on the server: skipping its
`onSuccess` would leave client state out of sync (two quick deletes, one row left on screen).
They receive `{ isLatest }` for side effects that should only follow the current call. Calls
aborted by `reset()` or destroy run no callback: the caller asked to forget them.

## `httpMutation()` vs `httpResource()`

`httpMutation()` mirrors `httpResource()` on purpose: same request shape.

- **`method` is required** and there is no `transferCache`: a mutation has no sensible GET
  default, and the SSR transfer cache only applies to reads.
- **Split progress (proposal).** `httpResource()` exposes a single `progress`; `httpMutation()`
  exposes `uploadProgress` and `downloadProgress`. Uploads matter far more for writes than for
  reads, and with a single signal a bar tracking the upload jumps back as soon as the response
  starts downloading. Angular 22 moves in the same direction on `HttpRequest`:
  `reportProgress` is deprecated there in favor of `reportUploadProgress` /
  `reportDownloadProgress`. `HttpResourceRequest` (which `httpMutation()` reuses) still only
  has `reportProgress`, so both signals are fed by that one flag.
- **A failed `parse` does not mean a failed write.** For a read, a `parse` error just means no
  value; for a write, the server has already applied it (see
  [Validating the response](./RECIPES.md#validating-the-response)), hence a dedicated
  `HttpMutationParseError`. A mutation primitive in Angular will have to surface that
  distinction too.

## Why not TanStack Query?

[`@tanstack/angular-query`](https://www.npmjs.com/package/@tanstack/angular-query) already ships
`injectMutation`, and is a mature choice if you want it. Different tradeoffs:

- **Scope**: it's a full cache/data-sync layer (queries, infinite queries, devtools,
  persistence) built on `@tanstack/query-core`, where mutations are one feature among many.
- **Setup**: `injectMutation` needs a `QueryClient` provided app-wide, even for a single
  mutation and zero queries while `mutation()` needs only an injection context.
- **Cancellation**: neither auto-cancels a mutation when superseded, a write may already have
  reached the server and be unsafe to cancel there, unlike a read. `mutation()` still hands
  `mutationFn` an `AbortSignal`, but only aborts it on explicit reset or destroy.
- **Ordering across mutations**: TanStack's `scope.id` runs the mutations sharing an id one at a
  time, the id being read from the mutation's options, never from the variables of the call.
  `mutationQueue()` does the same with an object rather than a string, and `{ queue, key }` takes
  the key from each call's input, so one mutation can keep its writes in order per entity. A
  mutation given the queue without a key waits for every key, where a TanStack mutation without
  a scope runs at once.

Reach for TanStack if you want retries, offline support, or cross-component cache invalidation.
Reach for this if you want the smallest primitive that behaves like `resource()`'s write-side
counterpart.

## Compared with NgRx Toolkit

[NgRx Toolkit](https://www.npmjs.com/package/@ngrx-toolkit/core) also has an `rxMutation()` and
an `httpMutation()`, usable outside a SignalStore. Same names, different behavior, so check which
one your IDE imports. As of version 22.0.1:

- **Concurrency**: calls are queued by default. Parallel and drop modes exist on both sides, but
  NgRx Toolkit can also cancel the previous call when a new one starts. This library doesn't on
  purpose: a write may already have reached the server.
- **Stale responses**: with parallel calls, the last response to arrive wins there; here, the
  last call made does.
- **Errors**: the promise never rejects, it resolves with a status to check. Here it rejects.
- **Dependencies**: NgRx and RxJS are required. This library only needs Angular.

Reach for NgRx Toolkit if you already use the SignalStore.

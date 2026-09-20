# Architecture

## Design choices

Directly inspired by the internal structure of `resource.ts` in Angular
core: raw writable signals, a generation counter to ignore responses from
stale requests, `PendingTasks` for SSR stability, and cleanup via
`DestroyRef` if the context is destroyed while a mutation is in flight.

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
  [Validating the response](./RECIPES.md#validating-the-response)). A mutation primitive in
  Angular will have to surface that distinction, not just an error.

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

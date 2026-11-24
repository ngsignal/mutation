# Changelog

## 0.9.2

- Docs: the README's Why explains the gap signals leave for writes, why a mutation returns a
  promise rather than an Observable, and what it leaves to TanStack Query.

## 0.9.1

- Docs: shorter README with the main features at a glance, an animated logo and a GIF of
  concurrent calls; every option, member and behavior detail moves to
  [docs/API.md](./docs/API.md).
- Docs: recipes rewritten shorter, without repeating the API reference. The optimistic update
  rollback now restores only writes that were never sent or that the server refused.

## 0.9.0

- **Breaking:** `reset()` and destroy reject a call in flight at once with an `'Aborted'`
  `AbortError`, like `fetch()`, even if `mutationFn` ignores its `AbortSignal` or rejects with
  its own error. `mutate()` used to wait for `mutationFn` and settle with its outcome, so code
  after `await mutate()` could still run once the component was gone. `rxMutation()` and
  `httpMutation()` already behaved this way.
- **Breaking:** `rxMutation()` resolves with the last value, once the Observable completes, not
  with the first one. An Observable that never completes stays pending until a reset or destroy.
- **Breaking:** when `parse` throws, `httpMutation()` rejects with an `HttpMutationParseError`.
  The original error is its `cause`.
- Feature: `wasNeverSent(error)` tells whether a call was cancelled before its `mutationFn` ran
  (`'Dropped'`, `'NotStarted'`, `'Destroyed'`), so its write never left, e.g. to roll back an
  optimistic update without checking an HTTP status. It is false for an error `mutationFn`
  rejects with, even another mutation's `'Dropped'`.
- Feature: `mutationQueue()` creates a write queue to share between mutations. Pass it as their
  `concurrency` and their calls run one at a time, in call order, whichever mutation makes them,
  with `mutation()`, `rxMutation()` and `httpMutation()` alike. `concurrency: { queue, key }`
  queues per key instead, e.g. per entity id; a call given the queue without a key waits for
  every key, and the calls after it wait for it. See
  [Ordering writes across mutations](./docs/RECIPES.md#ordering-writes-across-mutations).
- Feature: `httpMutation()`'s callbacks receive each call's `response`.
- Feature (types only): `MutationOptions` takes a `TContext` type parameter for the callbacks'
  context.
- Feature (types only): `TInput` defaults to `void` in `mutation()`, `rxMutation()` and
  `httpMutation()`, so a `mutationFn` or `request` without parameters gives a `mutate()` that
  takes no argument. It used to infer `unknown`, and `mutate()` required one. `TOutput` now
  defaults to `unknown`, as TypeScript requires after a defaulted parameter: it is still inferred
  from `mutationFn` or `parse`.
- Feature: a `debugName` option names the state signals in Angular DevTools: `debugName: 'save'`
  gives `save.status`, `save.value`, `save.error`, `save.input` and `save.pendingInputs`. Also on
  `rxMutation()` and `httpMutation()`.
- Feature: `concurrency: 'parallel'` names the default mode, for code that wants to state it.
  Leaving `concurrency` unset still means `'parallel'`.
- Fix: a call leaves `pendingInputs()` before its callbacks run, so `isPending()` is no longer
  true in the `onSuccess` of the only call in flight. Its pending task is still released after
  the callbacks.
- Fix: `reset()` called from `onSuccess` no longer aborts the `AbortSignal` of the call that
  just succeeded.
- Fix: a `mutate()` made by an abort listener during `reset()` is no longer aborted at once
  and left with an idle status.
- Fix: `reset()` with no call in flight, or a call aborted by `reset()` that settles later, no
  longer notifies `pendingInputs()` readers.
- Docs: the [ordering recipe](./docs/RECIPES.md#ordering-writes-across-mutations) bounds a request with a timeout (`timeout` in `request()`, or
  `AbortSignal.timeout()`), so a hung call can't hold a shared queue forever.
- Docs: in queue mode, `pendingInputs()[0]` is the input of the request in flight.
- Docs: a [testing recipe](./docs/RECIPES.md#testing-a-component): `fixture.whenStable()` waits
  for the calls in flight, and with `HttpTestingController` the request must be flushed first.
- Docs: a [Signal Forms recipe](./docs/RECIPES.md#submitting-a-signal-form) calling a mutation
  from `submit()`. The README now says that `isPending()` means `pendingInputs().length > 0` and
  that progress needs `reportProgress: true`.
- Docs: the [optimistic updates recipe](./docs/RECIPES.md#optimistic-updates) builds the
  optimistic view from `pendingInputs()`, with nothing to roll back.
- Docs: a [recipe](./docs/RECIPES.md#choosing-settings-by-http-method) maps each HTTP method to
  a `concurrency` mode and a retry policy, following RFC 9110 on idempotent methods. The retry
  recipe honors `Retry-After`, and the status code recipe covers `202 Accepted` and
  `Access-Control-Expose-Headers`.

## 0.8.0

- **Breaking:** `isPending()` is now true while any call is in flight, superseded and queued ones
  included, like Signal Forms' `submitting()`. It used to follow the latest call only, so it
  turned false when the latest call settled before an older one. It no longer always equals
  `status() === 'pending'`: `status()` still follows the latest call.
- **Breaking:** a call still queued when `reset()` runs or the injection context is destroyed now
  rejects with `'NotStarted'` instead of `'Aborted'`, so it can't be mistaken for a call aborted
  in flight, whose write may have reached the server.
- **Breaking:** `reset()` and destroy abort in-flight calls with a fixed reason,
  `DOMException('Aborted', 'AbortError')`. `rxMutation()`, `httpMutation()` and `fetch()` reject
  with it, instead of a message that depended on the platform.
- **Breaking (types only):** `MutationRef` and `HttpMutationRef` take `TError` third, as
  `mutation()` does, and the `hasValue()` narrowing parameter last:
  `MutationRef<TInput, TOutput, TError, TValue>`. Typing a field with a custom error is now
  `MutationRef<Dto, User, HttpErrorResponse>`.
- **Breaking (types only):** `HttpMutationRawBodyOptions` is no longer exported from
  `@ngsignal/mutation/http`: it was an internal helper. Open an issue if you relied on it.
- Docs: every `MutationRef` member is documented (TSDoc and the README's Public API table),
  and the README links to the recipes.
- Internal: built with TypeScript 6.0. The emitted code is unchanged.

## 0.7.0

- Feature: `pendingInputs()` lists the inputs of the calls still in flight, superseded and queued
  ones included, for a per-row spinner on a shared mutation or a "still saving" check.
  `input()` and `isPending()` only track the latest call. Also on `rxMutation()` and
  `httpMutation()`.
- Fix: with `concurrency: 'queue'`, a call still waiting in the queue when `reset()` runs or the
  injection context is destroyed now rejects with `'Aborted'` at once, instead of only once the
  call ahead of it settled (never, if its `mutationFn` ignored the `AbortSignal`).
- Docs: a call made after `reset()` in `'queue'` mode still waits for an aborted call already in
  flight, so writes stay in order.

## 0.6.3

- No change to the published code. Publishing to npm now requires a maintainer's approval
  (protected `npm` environment), on top of trusted publishing with provenance.
- Internal: property-based tests of the concurrency modes (fast-check), 100% test coverage
  enforced in CI, lint rules for floating promises, hardened GitHub Actions workflows (zizmor).
- Docs: [roadmap to 1.0](./docs/ROADMAP.md), OpenSSF Best Practices badge.

## 0.6.2

- No behavior change. Internal: concurrency modes and in-flight call tracking are extracted
  from `mutation()` (+135 B gzipped).
- Docs: README reworked (concurrency table, supersession diagram, cancellations), now on the
  npm page too.

## 0.6.1

- Fix: an exception thrown by `onSuccess`/`onError`/`onSettled` no longer changes the call's
  outcome (a successful write used to end up in `'error'`, and `mutate()` rejected with the
  callback's exception). It is reported to Angular's `ErrorHandler` and the remaining callbacks still run.
- Fix: `mutate()` called after the injection context is destroyed no longer calls `mutationFn`
  and leaves `status` stuck on `'pending'`; it rejects with an `AbortError` instead.

## 0.6.0

- **Breaking:** `onSuccess`/`onError`/`onSettled` now run for every call that settles, including
  a call superseded by a more recent `mutate()`, instead of only the latest one.
  Calls aborted by `reset()` or destroy still run no callback.
- Callbacks receive a last `context` argument, `{ isLatest }` for side effects that should only 
  follow the current call.

## 0.5.0

- Add `rxMutation()`, from `@ngsignal/mutation/rxjs-interop`: the mutation counterpart of
  `rxResource()`, for Observable-returning calls. Only the first emitted value is kept.
- Add `httpMutation()`, from `@ngsignal/mutation/http`: the mutation counterpart of
  `httpResource()`, with the same request description, `parse` option and `.text()`/`.blob()`/
  `.arrayBuffer()` variants, plus `uploadProgress`, `downloadProgress`, `statusCode` and
  `headers` signals. See [the recipes](./docs/RECIPES.md#using-observables-and-httpclient).
- New optional peer dependencies `rxjs` (`^6.5.3 || ^7.4.0`, the same range as Angular 21) and
  `@angular/common`, only needed for these secondary entry points. Not breaking:
  `@ngsignal/mutation` itself never loads them, with or without a bundler.

## 0.4.0

- Fix: ignoring the promise returned by `mutate()` (e.g. `(click)="save.mutate(x)"`) no longer
  reports an unhandled rejection when the call fails; the error is still exposed through
  `error`/`onError`, and a caller that `await`s or `.catch()`es the promise still receives it as-is.
- Add `concurrency: 'drop'`: while a call is in flight, further `mutate()` calls are ignored,
  e.g. to prevent double-submits.

## 0.3.0

- Add `concurrency?: 'queue'`, serializing `mutationFn` calls in submission order instead of
  starting them all immediately. Only commit the most
  recently submitted call's outcome.
- Add `onSettled?: (output, error, input) => void`, called after `onSuccess`/`onError`
  regardless of outcome, for cleanup that must run either way.
- Add an `input` signal holding the input of the most recent `mutate()` call, reset by
  `reset()`.
- Add `isIdle`/`isSuccess`/`isError` convenience signals to `mutation()`, derived from `status`.
- Add a `snapshot` signal: a discriminated union of `status`/`value`/`error` for exhaustive
  `switch`/`@switch` narrowing in a single read.
- Add a `hasValue()` type-guard narrowing `value` from `TOutput | undefined` to `TOutput`.
- feat: `error` and `onError` can be strong typed instead of `unknown`.

## 0.2.0

- **Breaking:** `mutate()` no longer aborts a previous in-flight call when superseded by a new
  one.
- Fix: destroying the injection context during a mid-flight `mutate()` call no longer rethrows.

## 0.1.0

- Initial release: `mutation()` primitive with `status`/`value`/`error`/`isPending`
  signals, `mutate()`/`reset()`, stale-response guarding via a generation counter,
  `PendingTasks` integration, and `DestroyRef` based cleanup.

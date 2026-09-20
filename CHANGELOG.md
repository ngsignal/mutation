# Changelog

## Unreleased

- New optional peer dependencies `rxjs` (`^6.5.3 || ^7.4.0`, the same range as Angular 21) and
  `@angular/common`, only needed for the new entry points below. Not breaking: the main entry
  point imports neither, and the adapters avoid RxJS-7-only APIs.
- Add `rxMutation()`, from `@ngsignal/mutation/rxjs-interop`: `mutation()` for
  Observable-returning calls (existing services, generated API clients, `HttpClient`...),
  bridging the Observable to the Promise `mutation()` expects and wiring cancellation to
  `unsubscribe()`. The mutation counterpart of `rxResource()`, except that only the first
  emitted value is kept: it resolves the call, then the Observable is unsubscribed.
- Add `httpMutation()`, from `@ngsignal/mutation/http`: the mutation counterpart of
  `httpResource()`. Takes a request description (`{ method, url, body, headers, params,
  reportProgress, ... }`), sends it through `HttpClient`, and exposes `progress`, `statusCode`
  and `headers` signals. They reset to `undefined` when a call's request starts (with
  `concurrency: 'queue'`, when the queued request starts, not when `mutate()` is called) and on
  `reset()`, and are guarded by the same stale-call semantics as `value`/`status`. A response
  without a body (`204`) resolves with `null`, as with `httpResource()`.
- Both live in secondary entry points so that `@ngsignal/mutation` never loads
  `@angular/common/http` or RxJS-7-only APIs, with or without a bundler.

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

# Changelog

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

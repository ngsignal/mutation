# Changelog

## Unreleased

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

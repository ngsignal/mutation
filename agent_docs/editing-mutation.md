# Editing `src/mutation.ts`

`mutation()` is modelled on Angular core's `resource.ts`. The bugs that matter here are
ordering bugs, not logic bugs. Argue every edit in terms of the mechanisms below, and
re-check them against the code: it is the source of truth, this file only summarizes it.

## Lifecycle mechanisms

- **Generation counter** (`generation`). Incremented by every call (`execute`), by
  `reset()` and on destroy. `commitSuccess` / `commitError` write the signals only when the
  call's captured generation is still current (`isLatest`).
- **Callbacks run for every settled call.** `settledCallContext` returns `{ isLatest }`, or
  `undefined` when the call was aborted (by `reset()` / destroy) or the context is
  destroyed: then no signal write and no `onSuccess` / `onError` / `onSettled`. A superseded
  call still runs its callbacks with `isLatest: false`. The promise returned by `mutate()`
  always settles with the call's real outcome. Each callback runs through `runCallback`: an
  exception goes to `ErrorHandler`, as in `OutputEmitterRef.emit()`, and must never reach the
  `catch` of `execute` (it would turn a successful write into an error).
- **After destroy**, `mutate()` rejects with `DOMException('Destroyed', 'AbortError')` before
  touching any signal or calling `mutationFn`.
- **Supersession does not abort.** A new `mutate()` does not abort earlier calls: they
  run to completion and their outcome is ignored. Only `reset()` and destroy abort
  (`abortAllInProgress` → `createCallTracker`'s `abortAll`): they abort every in-flight
  call's controller, release its pending task and forget it. Don't call supersession
  "cancellation".
- **`PendingTasks`.** Each call adds a task (`calls.start()`), released by `call.finish()`
  in the `finally` of `execute`, or
  earlier by `reset()` / destroy. A superseded call keeps its task until it settles.
  A leaked task means `ApplicationRef.isStable` never fires and SSR hangs.
- **`untracked()`.** The start-of-call writes (`status`, `error`, `input`) and the
  `mutationFn` invocation are wrapped so that calling `mutate()` from a reactive context
  never creates a dependency. Keep new signal writes on that path inside `untracked`.
- **`mutate()` vs `execute()`.** `mutate()` attaches a no-op `.catch` so that ignoring the
  promise (`(click)="save.mutate(x)"`) never reports an unhandled rejection. Callers that
  await it still receive the error.

## Concurrency modes (`options.concurrency`)

Each mode is a `ConcurrencyGate` (`createConcurrencyGate`): `admit()` before a call
starts, `run()` around `mutationFn`, `release()` when the latest call commits and on
`reset()` / destroy. `mutation()` itself never branches on the mode.

- *unset*: all calls start immediately; the latest one wins (generation counter).
- `'queue'` (`createQueueGate`): `mutationFn` calls are serialized through a promise tail
  that always settles, so one failure never blocks the queue. A call aborted while waiting
  rejects with an `AbortError` without calling `mutationFn`. Only the latest submitted
  call commits. `reset()` does not clear the tail: a call made after it still waits for an
  aborted call whose `mutationFn` ignores its `AbortSignal`, so writes stay ordered.
- `'drop'` (`createDropGate`): while locked, `admit()` returns false and `mutate()` rejects
  immediately with `DOMException('Dropped', 'AbortError')`, with no state change.
  `release()` unlocks it.

## State

Raw `WritableSignal`s `status`, `value`, `error`, `input`, exposed read-only.
`isPending` / `isIdle` / `isSuccess` / `isError` and the discriminated `snapshot` are
`computed`. `value` survives a later error (and stays visible while pending). Only
`reset()` or a new success replaces it.

## Review bar, in order

1. **Reactive lifecycle correctness**: no stale write, no leaked task, no tracked write,
   no call left in the tracker without `finish()` or `abortAll()`.
2. **Types**: `strict`; keep guarantees at the type level (`snapshot` narrowing,
   `hasValue()` predicate). No new `any`: prefer a generic (`TError`) or `unknown`.
3. **Bundle cost**: zero dependencies, tree-shakeable, no module-level state. A feature
   that substantially grows the file probably belongs in `docs/RECIPES.md`.
4. **API surface**: every option is permanent in a pre-1.0 package.

# Editing `src/mutation.ts`

Also covers `src/concurrency.ts` (the concurrency modes) and `src/call-tracker.ts` (the calls
in flight), split out of it.

`mutation()` is modelled on Angular core's `resource.ts`. The bugs that matter here are
ordering bugs, not logic bugs. Argue every edit in terms of the mechanisms below, and
re-check them against the code: it is the source of truth, this file only summarizes it.

## Lifecycle mechanisms

- **Latest call** (`Call`, `createCallTracker` in `call-tracker.ts`). Each admitted `mutate()` is a `Call` object
  (input, `AbortSignal`, `finish()`). The tracker remembers the latest one started;
  `reset()` and destroy forget it. `commitSuccess` / `commitError` write the signals only
  when the call is still the latest (`calls.isLatest(call)`).
- **Callbacks run for every settled call.** `settledCallContext` returns `{ isLatest }`, or
  `undefined` when the call was aborted (by `reset()` / destroy, which abort every call
  in flight): then no signal write and no `onSuccess` / `onError` / `onSettled`. A superseded
  call still runs its callbacks with `isLatest: false`. The promise returned by `mutate()`
  always settles with the call's real outcome. Each callback runs through `runCallback`: an
  exception goes to `ErrorHandler`, as in `OutputEmitterRef.emit()`, and must never reach the
  `catch` of `runCall` (it would turn a successful write into an error).
- **After destroy** (`destroyRef.destroyed`), `mutate()` rejects with `abortError('Destroyed')`
  before touching any signal or calling `mutationFn`. Every `AbortError` comes from
  `abortError()` (`abort-error.ts`): its reasons are the README's Cancellations table.
- **Supersession does not abort.** A new `mutate()` does not abort earlier calls: they
  run to completion and their outcome is ignored. Only `reset()` and destroy abort
  (`createCallTracker`'s `abortAll`): they abort every in-flight
  call's controller, release its pending task and forget it. Don't call supersession
  "cancellation".
- **`PendingTasks`.** Each call adds a task (`calls.start()`), released by `call.finish()`
  in the `finally` of `runCall`, or
  earlier by `reset()` / destroy. A superseded call keeps its task until it settles.
  A leaked task means `ApplicationRef.isStable` never fires and SSR hangs.
- **`untracked()`.** The start-of-call write (the `started` transition) and the
  `mutationFn` invocation are wrapped so that calling `mutate()` from a reactive context
  never creates a dependency. Keep new signal writes on that path inside `untracked`.
- **`mutate()` → `admitCall()` → `runCall()`.** `admitCall()` rejects at once after destroy
  or when the gate refuses the call; `runCall()` runs an admitted call. `mutate()` attaches a no-op `.catch` so that ignoring the
  promise (`(click)="save.mutate(x)"`) never reports an unhandled rejection. Callers that
  await it still receive the error.

## Concurrency modes (`options.concurrency`)

Each mode is a `ConcurrencyGate` (`createConcurrencyGate` in `concurrency.ts`): `admit()` before a call
starts, `run()` around `mutationFn`. A gate frees what it holds by itself, from `run()`, when
the call settles or its `AbortSignal` aborts (`reset()` / destroy). `mutation()` never
branches on the mode and never unlocks a gate.

- `'parallel'` or *unset* (the default): all calls start immediately; the latest one wins (`calls.isLatest()`).
- `'queue'` (`createQueueGate`): `mutationFn` calls are serialized through a promise tail
  that always settles, so one failure never blocks the queue. A call aborted while waiting
  rejects at once with an `AbortError`, without waiting for its turn, and never calls
  `mutationFn`. Only the latest submitted
  call commits. `reset()` does not clear the tail: a call made after it still waits for an
  aborted call whose `mutationFn` ignores its `AbortSignal`, so writes stay ordered.
- `'drop'` (`createDropGate`): while locked, `admit()` returns false and `mutate()` rejects
  immediately with `DOMException('Dropped', 'AbortError')`, with no state change.
  `run()` unlocks it when the call settles, before `mutation()` commits (so a callback can
  call `mutate()` again), or as soon as it aborts. Only the call holding the lock can unlock
  it: an aborted call that settles later leaves a newer call's lock alone.

## State

One `WritableSignal`, `state`: `{ snapshot, input }`. It changes only through the pure
transitions `started` / `succeeded` / `failed` and `IDLE` on `reset()` (`mutation-state.ts`), one write each, so
`status`, `value` and `error` can never disagree. `started` keeps the same `snapshot` when
already pending, so a second call doesn't notify `snapshot()` readers. `snapshot`, `status`,
`value`, `error`, `input` and `isIdle` / `isSuccess` / `isError` are `computed` from it. `isPending` is `computed` from the tracker's `pendingInputs` instead: it stays true
while a superseded call is in flight, so it can be true alongside `'success'` or `'error'`.
`value` survives a later error (and stays visible while pending). Only
`reset()` or a new success replaces it.

## Review bar, in order

1. **Reactive lifecycle correctness**: no stale write, no leaked task, no tracked write,
   no call left in the tracker without `finish()` or `abortAll()`.
2. **Types**: `strict`; keep guarantees at the type level (`snapshot` narrowing,
   `hasValue()` predicate). No new `any`: prefer a generic (`TError`) or `unknown`.
3. **Bundle cost**: zero dependencies, tree-shakeable, no module-level state. A feature
   that substantially grows the file probably belongs in `docs/RECIPES.md`.
4. **API surface**: every option is permanent in a pre-1.0 package.

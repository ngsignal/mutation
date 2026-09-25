# Editing `src/mutation.ts`

`mutation()` is modelled on Angular core's `resource.ts`. The bugs that matter here are
ordering bugs, not logic bugs. Argue every edit in terms of the mechanisms below, and
re-check them against the code: it is the source of truth, this file only summarizes it.

## Lifecycle mechanisms

- **Generation counter** (`generation`). Incremented by every call (`execute`), by
  `reset()` and on destroy. `commitSuccess` / `commitError` return early when the call's
  captured generation is stale or the context is destroyed: no signal write and no
  `onSuccess` / `onError` / `onSettled`. The promise returned by `mutate()` still
  settles with the call's real outcome.
- **Supersession does not abort.** A new `mutate()` does not abort earlier calls: they
  run to completion and their outcome is ignored. Only `reset()` and destroy abort
  (`abortAllInProgress`): they abort every controller in `activeCalls`, release its
  pending task and clear the map. Don't call supersession "cancellation".
- **`PendingTasks`.** Each call adds a task, released in the `finally` of `execute`, or
  earlier by `reset()` / destroy. A superseded call keeps its task until it settles.
  A leaked task means `ApplicationRef.isStable` never fires and SSR hangs.
- **`untracked()`.** The start-of-call writes (`status`, `error`, `input`) and the
  `mutationFn` invocation are wrapped so that calling `mutate()` from a reactive context
  never creates a dependency. Keep new signal writes on that path inside `untracked`.
- **`mutate()` vs `execute()`.** `mutate()` attaches a no-op `.catch` so that ignoring the
  promise (`(click)="save.mutate(x)"`) never reports an unhandled rejection. Callers that
  await it still receive the error.

## Concurrency modes (`options.concurrency`)

- *unset*: all calls start immediately; the latest one wins (generation counter).
- `'queue'`: `mutationFn` calls are serialized through `enqueue` / `queueTail`, which
  always settles so one failure never blocks the queue. A call aborted while waiting
  rejects with an `AbortError` without calling `mutationFn`. Only the latest submitted
  call commits.
- `'drop'`: while `dropLocked`, `mutate()` rejects immediately with
  `DOMException('Dropped', 'AbortError')`, with no state change. The lock is released on
  commit and by `abortAllInProgress`.

## State

Raw `WritableSignal`s `status`, `value`, `error`, `input`, exposed read-only.
`isPending` / `isIdle` / `isSuccess` / `isError` and the discriminated `snapshot` are
`computed`. `value` survives a later error (and stays visible while pending). Only
`reset()` or a new success replaces it.

## Review bar, in order

1. **Reactive lifecycle correctness**: no stale write, no leaked task, no tracked write,
   no controller left in `activeCalls`.
2. **Types**: `strict`; keep guarantees at the type level (`snapshot` narrowing,
   `hasValue()` predicate). No new `any`: prefer a generic (`TError`) or `unknown`.
3. **Bundle cost**: zero dependencies, tree-shakeable, no module-level state. A feature
   that substantially grows the file probably belongs in `docs/RECIPES.md`.
4. **API surface**: every option is permanent in a pre-1.0 package.

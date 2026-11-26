# Editing `src/core/mutation.ts`

Also covers `src/core/concurrency.ts` (the concurrency modes) and `src/core/call-tracker.ts` (the calls
in flight), split out of it.

`mutation()` is modelled on Angular core's `resource.ts`. The bugs that matter here are
ordering bugs, not logic bugs. Argue every edit in terms of the mechanisms below, and
re-check them against the code: it is the source of truth, this file only summarizes it.

## Adapters

`mutation()`, `rxMutation()` and `httpMutation()` all call `createMutation(options, adapter)`,
which holds everything below. The adapter provides `run` (in place of `mutationFn`), `createContext` (extra
callback context, filled during the call) and an optional `onReset`. An adapter that needs more
gets a new hook here, not a wrapper around the returned ref.

## Lifecycle mechanisms

- **Latest call** (`Call`, `createCallTracker` in `call-tracker.ts`). Each admitted `mutate()` is a `Call` object
  (input, `AbortSignal`, `finish(commit)`). The tracker remembers the latest one started;
  `reset()` and destroy forget it. `commit` writes the signals only when the call is still the
  latest (`calls.isLatest(call)`).
- **Callbacks run for every settled call.** `commit` passes them `{ isLatest }`, and does nothing
  when the call was aborted (by `reset()` / destroy, which abort every call in flight, or by a
  `'queue-latest'` replacement): then no
  signal write and no `onSuccess` / `onError` / `onSettled`. A superseded
  call still runs its callbacks with `isLatest: false`. The promise returned by `mutate()`
  settles with the call's own outcome, superseded or not, or rejects with the abort reason as
  soon as `reset()` / destroy aborts the call (`rejectOnAbort`), even if `mutationFn` ignores
  its signal: `'NotStarted'` if the call was still queued (`'Replaced'` if replaced), the signal's `'Aborted'` once
  `mutationFn` ran. Only the core rejects on abort: the queue keeps an aborted call's turn and
  skips its task then, and still waits for a real write, so it stays ordered. Each callback runs through `runCallback`: an
  exception goes to `ErrorHandler`, as in `OutputEmitterRef.emit()`, and must never reach the
  `catch` of `runCall` (it would turn a successful write into an error).
- **After destroy** (`destroyRef.destroyed`), `mutate()` rejects with `neverSentError('Destroyed')`
  before touching any signal or calling `mutationFn`. Every `AbortError` comes from
  `abort-error.ts`: `neverSentError()` for a call rejected before `mutationFn` ran (created
  by `mutation.ts` and the `'queue-latest'` gate, and they make `wasNeverSent()` true), `abortedError()` for a call
  aborted in flight. `runCall` clears the never-sent mark from any error `mutationFn` rejects
  with (`markMaybeSent`). The reasons are the Cancellations table in `docs/API.md`.
- **Supersession does not abort.** A new `mutate()` does not abort earlier calls: they
  run to completion and their outcome is ignored. Only `reset()` and destroy abort
  (`createCallTracker`'s `abortAll`): they abort every in-flight
  call's controller, release its pending task and forget it. The tracker listens to destroy only while calls are
  in flight, so an idle mutation leaves no reference in a long-lived injector. `'queue-latest'`
  aborts the one call it replaces, before it ran (`Call.abort`). Don't call supersession
  "cancellation".
- **Settling order** (`call.finish(commit)`). A settled call first leaves the tracker, so its
  callbacks see it out of `pendingInputs()` / `isPending()` and a `reset()` they call doesn't
  abort its signal; then `commit` writes the signals and runs the callbacks; then its pending
  task is released, so a call a callback starts keeps the app unstable.
- **`PendingTasks`.** Each call adds a task (`calls.start()`), released by `call.finish()` once
  the callbacks have run, or earlier by `reset()` / destroy. A superseded call keeps its task
  until it settles. A leaked task means `ApplicationRef.isStable` never fires and SSR hangs.
- **`reset()` order.** It writes `IDLE` and runs `onReset` before `abortAll()`, and `abortAll()`
  forgets the calls before aborting them: a call that an abort listener starts is a new call,
  kept with its state.
- **`untracked()`.** The start-of-call write (the `started` transition) and the gate's `run()`,
  which may write `pendingInputs()` and calls `mutationFn`, are wrapped so that calling `mutate()` from a reactive context
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
- `'queue'`, a `mutationQueue()` or `{ queue, key }` (`createQueueGate` over the `WriteQueue` of
  `mutation-queue.ts`): `'queue'` is a queue of its own, a `MutationQueue` is shared by every
  mutation given it, and a key gives each key its own tail, deleted once it drains. A call without
  a key uses the `undefined` tail and is a barrier: it waits for every tail, and keyed calls wait
  for it too. With one tail or none, no `Promise.all`, so `'queue'` keeps its microtask timing. The gate gets
  the call (`input`, `AbortSignal`) to compute the key, and wraps `adapter.run`, so a shared queue
  works for every adapter and `request()` runs when the call leaves the queue. `reset()` / destroy
  only abort the mutation's own calls. `mutationFn` calls are serialized through a promise tail
  that always settles, so one failure never blocks the queue. A call aborted while waiting
  rejects at once with an `AbortError`, without waiting for its turn, and never calls
  `mutationFn`. Only the latest submitted
  call commits. `reset()` does not clear the tail: a call made after it still waits for an
  aborted call whose `mutationFn` ignores its `AbortSignal`, so writes stay ordered.
- `'queue-latest'` (`replaceWaitingCall`, a decorator over a `'queue'` gate): a call made while
  the line isn't empty replaces the waiting one (`Call.abort(neverSentError('Replaced'))`), which
  leaves `pendingInputs()` at once and keeps its turn, skipped like any aborted call. The decorator
  counts the calls in line and decrements before `mutation()` resumes the caller, so the head of
  the line is never replaced. Single line only: a keyed variant needs a count per key.
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

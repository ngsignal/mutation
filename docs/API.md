# API reference

- [`mutation()`](#mutation)
- [Calls in flight](#calls-in-flight)
- [Callbacks](#callbacks)
- [Reading the state](#reading-the-state)
- [Concurrency](#concurrency)
- [Cancellations](#cancellations)
- [rxMutation & httpMutation](#rxmutation--httpmutation)

## `mutation()`

`mutation<TInput, TOutput, TError = unknown>(options)`

`TError` types the error signal and the error callbacks, `unknown` by default. It is an
assertion, not a check: they receive whatever the mutation function rejects with, abort errors
included.

`TInput` defaults to `void`: a mutation function without parameters gives a `mutate()` without
argument.

### Options

| Option        | Type                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| `mutationFn`  | `(input: TInput, abortSignal: AbortSignal) => Promise<TOutput>`                |
| `onSuccess?`  | `(output: TOutput, input: TInput, context: MutationCallbackContext) => void`   |
| `onError?`    | `(error: TError, input: TInput, context: MutationCallbackContext) => void`     |
| `onSettled?`  | `(output: TOutput \| undefined, error: TError \| undefined, input: TInput, context: MutationCallbackContext) => void` |
| `concurrency?`| `'parallel' \| 'queue' \| 'drop' \| MutationQueue \| { queue, key }` (default `'parallel'`) |
| `injector?`   | `Injector`: creates the mutation outside an injection context (e.g. factory functions) |
| `debugName?`  | `string`: names the state signals in Angular DevTools (`'save'` → `save.status`) |

### Returned `MutationRef<TInput, TOutput, TError>`

| Member            | Type                                | Follows                                    |
| ----------------- | ----------------------------------- | ------------------------------------------ |
| `status`          | `Signal<'idle' \| 'pending' \| 'success' \| 'error'>` | the latest call               |
| `value`           | `Signal<TOutput \| undefined>`      | the latest success, until `reset()`        |
| `error`           | `Signal<TError \| undefined>`       | the latest call                            |
| `input`           | `Signal<TInput \| undefined>`       | the latest call                            |
| `isIdle` / `isSuccess` / `isError` | `Signal<boolean>`  | `status()`                                 |
| `isPending`       | `Signal<boolean>`                   | every call in flight                       |
| `pendingInputs`   | `Signal<readonly TInput[]>`         | every call in flight                       |
| `snapshot`        | `Signal<MutationSnapshot<TOutput, TError>>` | the latest call                    |
| `hasValue()`      | type guard: `value()` is `TOutput`  | `value()`                                  |
| `mutate(input)`   | `Promise<TOutput>`                  | this call                                  |
| `reset()`         | `void`                              | aborts every call in flight                |

`MutationRef` is meant to be used, not implemented: a minor version may add members.

`mutate()` returns a promise that settles with the call's outcome. Ignoring it, as in
`(click)="save.mutate(x)"`, is safe: a failure never reports an unhandled rejection, and still
shows in the error signal.

`reset()` brings the state back to idle and aborts every call in flight (see
[Cancellations](#cancellations)).

Every call in flight registers with Angular's `PendingTasks`, so the app isn't stable, and SSR
doesn't render, until it settles. A reset or destroy releases it at once.

## Calls in flight

A new call never aborts the previous one: its write may already have reached the server. Both run
to completion. The state signals (status, value, error, input) show only the latest call, but
every call runs its [callbacks](#callbacks).

`pendingInputs()` lists the inputs of every call in flight, superseded and queued ones included,
so one mutation shared by a list can disable each row being written:

```html
<button (click)="deleteRow.mutate(row.id)" [disabled]="deleteRow.pendingInputs().includes(row.id)">
  Delete
</button>
```

`isPending()` is true while that list isn't empty, like `submitting()` in Signal Forms. So it can
stay true after a success or error, while a superseded call still runs. A reset or destroy makes
it false. A call leaves the list just before its callbacks run, in the same task. It also gives
[optimistic updates without a rollback](./RECIPES.md#optimistic-updates).

## Callbacks

Side effects (cache updates, navigation, toasts) can live where the mutation is declared, in
addition to awaiting `mutate()` at the call site:

```ts
readonly createTodo = mutation<string, Todo>({
  mutationFn: (title, abortSignal) => this.api.createTodo(title, abortSignal),
  onSuccess: (todo) => this.todos.update((list) => [...list, todo]),
  onError: (err) => this.toast.show(String(err)),
});
```

Every call runs its callbacks, so creating two todos quickly appends both. `isLatest` tells the
calls apart, for side effects that should only follow the current one:

```ts
onSuccess: (todo, title, { isLatest }) => {
  this.todos.update((list) => [...list, todo]);
  if (isLatest) this.form.reset();
},
```

`onSettled` runs after the success or error callback, for cleanup either way (closing a modal,
releasing a lock). Calls aborted by a reset or destroy run no callback.

## Reading the state

### snapshot

Status, value and error are separate signals, so TypeScript can't narrow the value from the
status. `snapshot()` reads them together as one discriminated union, for an exhaustive `@switch`:

```ts
@let snap = createInvoice.snapshot();
@switch (snap.status) {
  @case ('success') { {{ snap.value.id }} }
  @case ('error') { {{ snap.error }} }
  @default { Idle or pending… }
}
```

The value is kept while pending and after an error, until a new success or a reset.

### hasValue

The value is undefined until the first success. `hasValue()` narrows its type:

```ts
if (createInvoice.hasValue()) {
  downloadPdf(createInvoice.value());
}
```

It only checks for undefined: a mutation that returns nothing keeps an undefined value even after
a success (check `isSuccess()` instead), and an HTTP 204 gives a `null` value, for which it's true.

## Concurrency

What happens to a second call while one is still in flight:

| `concurrency`   | Second `mutate()`                                                        | Typical use                                  |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| `'parallel'` (default) | Runs right away, in parallel                                      | Independent writes (adding items to a list)  |
| `'queue'`       | Waits for the previous call, then runs: submission order is kept         | Writes that must reach the server in order (reordering, autosave) |
| `'queue-latest'` | Waits like `'queue'`, but replaces the call already waiting, which rejects at once (`'Replaced'`) and is never sent | Writes that each carry the whole state (autosave with `PUT`) |
| `'drop'`        | Rejected at once (`'Dropped'`), never sent, signals untouched            | Double-submit protection (payment, form submit) |
| a `mutationQueue()` | Waits for the previous call of every mutation given the same queue   | Different writes to the same data (rename, then delete) |
| `{ queue, key }` | Waits for the previous call with the same key; other keys run at once. A call on the same queue without a key waits for every key | Order per entity (autosave of several documents) |

In every mode, the state signals follow the latest call of the mutation itself. Shared queues work
the same with the three functions: see
[Ordering writes across mutations](./RECIPES.md#ordering-writes-across-mutations) for examples and
pitfalls.

In queue mode, a call made after a reset still waits for an aborted call in flight to settle, so
writes stay in order. Pass the abort signal on to the request (the RxJS and HTTP variants do) so
the queue frees up at once.

## Cancellations

Every cancellation rejects the call with an `AbortError`. Its message tells whether the write may
have reached the server:

| Cancelled by                                      | Message                           | Write sent?                    |
| ------------------------------------------------- | --------------------------------- | ------------------------------ |
| `concurrency: 'drop'`, a call already in flight   | `'Dropped'`                       | No                             |
| `concurrency: 'queue-latest'`, a newer call while waiting | `'Replaced'`, at once     | No                             |
| `mutate()` after the injection context is destroyed | `'Destroyed'`                   | No                             |
| `reset()`/destroy while queued                    | `'NotStarted'`, at once           | No                             |
| `reset()`/destroy while in flight                 | `'Aborted'`, at once              | **Maybe**: the request had left |

`mutate()` rejects at once, like `fetch()`, even if the mutation function ignores the signal:
pass it on anyway, so the request itself stops.

`wasNeverSent(error)` is true for the first four rows. It is false for any error the mutation
function rejects with, even another mutation's `'Dropped'`: that call ran. HTTP status codes are
yours to check. See [Optimistic updates](./RECIPES.md#optimistic-updates) for a rollback that
skips the writes that may have been applied.

> [!WARNING]
> Aborting never undoes a write the server already received: a reset only stops the client
> from waiting for it.

## rxMutation & httpMutation

For Observables, two variants mirror Angular's split between its RxJS and HTTP resources:

| Angular (reads) | Mutations          | Import from                      | You provide                                                          |
| --------------- | ------------------ | -------------------------------- | -------------------------------------------------------------------- |
| `rxResource`    | **`rxMutation`**   | `@ngsignal/mutation/rxjs-interop` | any Observable, e.g. an existing service: `(dto) => this.users.create(dto)` |
| `httpResource`  | **`httpMutation`** | `@ngsignal/mutation/http`         | a request description: `(dto) => ({ method: 'POST', url, body: dto })` |

They live in secondary entry points, so the main entry never loads RxJS or Angular's HTTP client.
They need RxJS 6.5+ or 7 and, for the HTTP variant, `@angular/common`: both are optional peer
dependencies.

A call resolves with the last value, once the Observable completes. A reset or destroy
unsubscribes, which aborts an `HttpClient` request.

`httpMutation()` sends the request itself, so it also exposes, for the latest call:

| Member             | Type                                   |
| ------------------ | -------------------------------------- |
| `statusCode`       | `Signal<number \| undefined>`          |
| `headers`          | `Signal<HttpHeaders \| undefined>`     |
| `uploadProgress`   | `Signal<HttpProgressEvent \| undefined>` |
| `downloadProgress` | `Signal<HttpProgressEvent \| undefined>` |

They reset to undefined when a call's request starts and on a reset, and ignore a superseded
call's events. In queue mode, they follow the request actually in flight, whose input is
`pendingInputs()[0]`. Progress needs `reportProgress: true`; upload and download are kept apart
on purpose (see [Architecture](./ARCHITECTURE.md#httpmutation-vs-httpresource)).

The request description is built when the request is sent, outside any reactive context. The
error is an `HttpErrorResponse` for HTTP failures, but an interceptor may throw anything else:
pass `HttpErrorResponse` as `TError` only if you rely on it.

Recipes: [reusing an Observable-returning service](./RECIPES.md#reusing-an-observable-returning-service),
[describing an HTTP request](./RECIPES.md#describing-an-http-request),
[validating the response](./RECIPES.md#validating-the-response),
[non-JSON responses](./RECIPES.md#non-json-responses),
[upload progress](./RECIPES.md#upload-progress),
[status code and headers](./RECIPES.md#status-code-and-headers),
[requests that must outlive the component](./RECIPES.md#requests-that-must-outlive-the-component).

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

`TError` types the error signal and the error callbacks; omit it and they stay `unknown`. It is
an assertion, not a check: they receive whatever `mutationFn` rejects with, an abort error
included.

`TInput` defaults to `void`: a `mutationFn` (or `request`) without parameters gives a
`mutate()` that takes no argument.

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

`reset()` brings the state signals back to their initial state and aborts every call in flight:
see [Cancellations](#cancellations).

Every call in flight registers with Angular's `PendingTasks`, so the app isn't stable (and SSR
doesn't render) until it settles. A reset or destroy releases it at once rather than waiting for
a stale call.

## Calls in flight

Calling `mutate()` again while a call is in flight does **not** abort the previous one: its write
may already have reached the server. Both calls run to completion. Only the latest call's outcome
shows in the state signals (status, value, error, input), but each call still runs its
[callbacks](#callbacks).

The input signal only follows the latest call. `pendingInputs()` lists the inputs of every call
still in flight (superseded and queued ones included), so one mutation shared by a list can
disable each row being written:

```html
<button (click)="deleteRow.mutate(row.id)" [disabled]="deleteRow.pendingInputs().includes(row.id)">
  Delete
</button>
```

`isPending()` is shorthand for `pendingInputs().length > 0`, like `submitting()` in Signal Forms.
It stays true after a success or error while a superseded call is still running. A reset or
destroy turns it false. A call leaves the list before its callbacks run: an `onSuccess` sees only
the other calls. `pendingInputs()` also gives
[optimistic updates without a rollback](./RECIPES.md#optimistic-updates).

## Callbacks

Run side effects (cache updates, navigation, toasts) right where the mutation is declared, in
addition to `await mutate(...)` at the call site.

```ts
readonly createTodo = mutation<string, Todo>({
  mutationFn: (title, abortSignal) => this.api.createTodo(title, abortSignal),
  onSuccess: (todo) => this.todos.update((list) => [...list, todo]),
  onError: (err) => this.toast.show(String(err)),
});
```

Since every call runs its callbacks, creating two todos quickly appends both. `isLatest` tells
calls apart, for side effects that should only follow the current one:

```ts
onSuccess: (todo, title, { isLatest }) => {
  this.todos.update((list) => [...list, todo]);
  if (isLatest) this.form.reset();
},
```

`onSettled` runs after the success or error callback, whichever fired; use it for cleanup that
must happen either way (closing a modal, releasing a UI lock).

Calls aborted by a reset or by destroying the injection context run no callback.

## Reading the state

### snapshot

Status, value and error are three separate signals, so TypeScript can't narrow the value from
the status alone. `snapshot()` reads them together as one discriminated union, ready for an
exhaustive `@switch`:

```ts
@let snap = createInvoice.snapshot();
@switch (snap.status) {
  @case ('success') { {{ snap.value.id }} }
  @case ('error') { {{ snap.error }} }
  @default { Idle or pending… }
}
```

The value is kept while pending and after an error: the last known value stays until a new
success or a reset.

### hasValue

The value is undefined until the first success. `hasValue()` narrows its type:

```ts
if (createInvoice.hasValue()) {
  downloadPdf(createInvoice.value());
}
```

For a mutation that returns nothing, the value stays undefined even after a success: check
`isSuccess()` instead.

## Concurrency

What happens to a second call while one is still in flight:

| `concurrency`   | Second `mutate()`                                                        | Typical use                                  |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| `'parallel'` (default) | Runs right away, in parallel                                      | Independent writes (adding items to a list)  |
| `'queue'`       | Waits for the previous call, then runs: submission order is kept         | Writes that must reach the server in order (reordering, autosave) |
| `'drop'`        | Rejected at once (`'Dropped'`), `mutationFn` never runs, signals untouched | Double-submit protection (payment, form submit) |
| a `mutationQueue()` | Waits for the previous call of every mutation given the same queue   | Different writes to the same data (rename, then delete) |
| `{ queue, key }` | Waits for the previous call with the same key; other keys run at once. A call on the same queue without a key waits for every key | Order per entity (autosave of several documents) |

In every mode, the state signals reflect the most recent call of the mutation itself. Sharing a
queue works the same with `mutation()`, `rxMutation()` and `httpMutation()`: see
[Ordering writes across mutations](./RECIPES.md#ordering-writes-across-mutations).

In queue mode, a call made after a reset still waits for an aborted call already in flight to
settle, so writes stay in order. Pass the abort signal on to your request (the RxJS and HTTP
variants do) so the queue frees up at once.

## Cancellations

Every cancellation rejects the call with an `AbortError`, so `error.name === 'AbortError'`
catches them all. The message tells whether the write may have reached the server, e.g. before
rolling back an optimistic update:

| Cancelled by                                      | Message                           | Write sent?                    |
| ------------------------------------------------- | --------------------------------- | ------------------------------ |
| `concurrency: 'drop'`, a call already in flight   | `'Dropped'`                       | No, `mutationFn` never ran     |
| `mutate()` after the injection context is destroyed | `'Destroyed'`                   | No, `mutationFn` never ran     |
| `reset()`/destroy while queued (`'queue'`)        | `'NotStarted'`, at once           | No, `mutationFn` never ran     |
| `reset()`/destroy while in flight                 | `'Aborted'`, at once              | **Maybe**: the request had left |

`mutate()` rejects at once, like `fetch()`, even if `mutationFn` ignores the signal or rejects
with its own error: pass the signal on anyway, so the request itself stops.

`wasNeverSent(error)` is true for the first three rows, where `mutationFn` never ran. It is false
for any error `mutationFn` rejects with, even another mutation's `'Dropped'`: that call ran.
HTTP status codes are yours to check. A rollback can skip only the writes that may have been
applied:

```ts
this.deleteUser.mutate(user).catch((error: unknown) => {
  const rejectedByServer = error instanceof HttpErrorResponse && error.status >= 400;
  if (wasNeverSent(error) || rejectedByServer) this.users.update((users) => [...users, user]);
});
```

> [!WARNING]
> Aborting never undoes a write the server already received: a reset only stops the client
> from waiting for it.

## rxMutation & httpMutation

`mutationFn` returns a promise. For Observables, two variants mirror Angular's split between
its RxJS and HTTP resources:

| Angular (reads) | Mutations          | Import from                      | You provide                                                          |
| --------------- | ------------------ | -------------------------------- | -------------------------------------------------------------------- |
| `rxResource`    | **`rxMutation`**   | `@ngsignal/mutation/rxjs-interop` | any Observable, e.g. an existing service: `(dto) => this.users.create(dto)` |
| `httpResource`  | **`httpMutation`** | `@ngsignal/mutation/http`         | a request description: `(dto) => ({ method: 'POST', url, body: dto })` |

Like Angular's own RxJS interop, they live in secondary entry points, so the main entry never
loads RxJS or Angular's HTTP client. They need RxJS (6.5+ or 7, like Angular 21) and, for the
HTTP variant, `@angular/common`: both are optional peer dependencies.

A call resolves with the last value, once the Observable completes. A reset or destroying the
injection context unsubscribes, which aborts an `HttpClient` request. `httpMutation()` sends the
request itself, so it also exposes the status code and headers as signals, plus upload and
download progress when the request sets `reportProgress: true`. Upload progress needs the XHR
backend: see [Upload progress](./RECIPES.md#upload-progress).

Recipes: [reusing an Observable-returning service](./RECIPES.md#reusing-an-observable-returning-service),
[describing an HTTP request](./RECIPES.md#describing-an-http-request),
[validating the response](./RECIPES.md#validating-the-response),
[non-JSON responses](./RECIPES.md#non-json-responses),
[status code and headers](./RECIPES.md#status-code-and-headers),
[requests that must outlive the component](./RECIPES.md#requests-that-must-outlive-the-component).

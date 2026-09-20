# Recipes

## Working with resource

`mutation()` has no cache and won't touch a `resource()`/`httpResource()` for you. Two common patterns:

### Refreshing a resource after a mutation

```ts
readonly usersResource = resource({
  loader: ({ abortSignal }) => this.api.fetchUsers(abortSignal),
});

readonly createUser = mutation<string, User>({
  mutationFn: (name, signal) => this.api.createUser(name, signal),
  onSuccess: () => this.usersResource.reload(),
});
```

Use `onSuccess` (or an `effect()` on `status()`) to react to whichever call ends up being
current.

### Optimistic updates

`resource().value` is a `WritableSignal`: update it immediately, roll back in `.catch()`
(`mutate()` always rejects like `mutationFn` does, for that specific call):

```ts
readonly deleteUser = mutation<string, void>({
  mutationFn: (id, signal) => this.api.deleteUser(id, signal),
});

removeUser(id: string) {
  const previous = this.usersResource.value();
  this.usersResource.update((users) => users.filter((u) => u.id !== id));

  this.deleteUser.mutate(id).catch(() => this.usersResource.set(previous));
}
```

`deleteUser` is one shared instance: calling `removeUser` twice in a row no longer cancels the
first delete (see [stale-response guarding](../README.md#stale-response-guarding)), both DELETE
requests run to completion independently, and each call's own `.catch()` rolls back its own
optimistic update if it fails.

<a id="using-httpclient"></a>

## Using Observables and HttpClient

Pick the variant matching what you already have (see [the table](../README.md#rxmutation--httpmutation)).
Both accept the same `onSuccess`/`onError`/`onSettled`/`concurrency`/`injector` options as
`mutation()` — see [the main README](../README.md#return-value) for what each does.

### Reusing an Observable-returning service

`rxMutation()` takes any Observable — an existing service, a generated API client, or a raw
`HttpClient` call. Same shape as `mutation()`, but `mutationFn` returns an `Observable`:

```ts
import { rxMutation } from '@ngsignal/mutation/rxjs-interop';

readonly createUser = rxMutation<CreateUserDto, User>({
  mutationFn: (dto) => this.userService.create(dto),
});
```

Unlike `rxResource()`, only the first value counts: it resolves the call, then `rxMutation()`
unsubscribes. Completing without a value rejects. With `observe: 'events'`, that first value is
`Sent`, not the body — use `httpMutation()` for progress.

### Describing an HTTP request

`httpMutation()` takes a request description instead — the same shape as `httpResource()`'s
(`url`, `body`, `headers`, `params`, `context`, `reportProgress`, ...), except `method` is
required. It sends the request itself through `HttpClient`, so interceptors apply as usual:

```ts
import { httpMutation } from '@ngsignal/mutation/http';

readonly createUser = httpMutation<CreateUserDto, User>({
  request: (dto) => ({ method: 'POST', url: '/api/users', body: dto }),
});
```

A response without a body (e.g. `204 No Content` on a DELETE) resolves with `null`, as with
`httpResource()`: `HttpClient` returns `null` and it is typed `TOutput` as-is. Declare the
output type accordingly:

```ts
readonly deleteUser = httpMutation<string, null>({
  request: (id) => ({ method: 'DELETE', url: `/api/users/${id}` }),
});
```

`hasValue()` only checks for `undefined`, so it returns `true` after a `204`: `null` is the
value. Declaring `TOutput` as `null` (or `User | null`) keeps the narrowed type honest.

`request(input)` runs when the request is sent, outside any reactive context: with the default
concurrency that is inside `mutate()`, but with `concurrency: 'queue'` it is when the queued
request starts. Signals it reads (an auth token, an `ETag` for `If-Match`) are read at that
moment, not when `mutate()` was called — pass values through `input` to freeze them earlier.

Requires `provideHttpClient()`.

### Validating the response

`parse` transforms or validates the response body before it resolves the call — the same option
as `httpResource()`'s. It receives the raw body (`unknown` for JSON) and its return type becomes
`TOutput`, so it pairs well with a schema library:

```ts
readonly createUser = httpMutation({
  request: (dto: CreateUserDto) => ({ method: 'POST', url: '/api/users', body: dto }),
  parse: (raw) => UserSchema.parse(raw), // value: Signal<User | undefined>
});
```

If `parse` throws, the call fails with that error: `status()` is `'error'` while `statusCode()`
still holds the success code (e.g. `201`), because **the server has already applied the write**.
Handle it as a contract mismatch, not as a failed write — retrying would write twice. For a
body-less response (`204`), `parse` receives `null`.

### Non-JSON responses

Like `httpResource()`, three variants read the response body differently. Typical for a write
that returns a generated file:

```ts
readonly exportInvoice = httpMutation.blob<number>({
  request: (id) => ({ method: 'POST', url: `/api/invoices/${id}/pdf` }),
}); // value: Signal<Blob | undefined>
```

| Variant                      | Response body | `parse`                                   |
| ---------------------------- | ------------- | ----------------------------------------- |
| `httpMutation()`             | JSON          | optional                                  |
| `httpMutation.text()`        | `string`      | required if `TOutput` isn't `string`      |
| `httpMutation.blob()`        | `Blob`        | required if `TOutput` isn't `Blob`        |
| `httpMutation.arrayBuffer()` | `ArrayBuffer` | required if `TOutput` isn't `ArrayBuffer` |

### Requests that must outlive the component

Like `mutation()`, `httpMutation()` aborts its in-flight requests when its injection context is
destroyed: navigating away from a component unsubscribes, which cancels the HTTP request.
`keepalive: true` does not prevent that — it only lets a request survive a full page unload,
and here the request is cancelled by the app itself. For a write that must complete anyway
(a "save on leave"), create the mutation with a longer-lived injector, e.g. in a
`providedIn: 'root'` service, or with `injector: inject(EnvironmentInjector)`.

### Upload progress

Set `reportProgress: true` in the request description to feed the `uploadProgress` and
`downloadProgress` signals (kept apart on purpose, see
[ARCHITECTURE](./ARCHITECTURE.md#httpmutation-vs-httpresource)).

```ts
readonly uploadAvatar = httpMutation<File, User>({
  request: (file) => {
    const body = new FormData();
    body.append('avatar', file);
    return { method: 'POST', url: '/api/avatar', body, reportProgress: true };
  },
});
```

```html
@if (uploadAvatar.isPending() && uploadAvatar.uploadProgress(); as p) {
  <progress [value]="p.loaded" [max]="p.total"></progress>
}
```

Upload progress needs the XHR backend, the default on Angular 21. Angular 22 switched
`provideHttpClient()` to `fetch`, which ignores `reportProgress` for uploads: without
`withXhr()`, `uploadProgress` silently stays `undefined`. (Angular 22's `reportUploadProgress`
would throw NG02824 instead, but the request description only accepts `reportProgress`.)

```ts
provideHttpClient(withXhr()) // Angular 22+, only if you need upload progress
```

### Status code and headers

`httpMutation()` also exposes `statusCode` and `headers`, read from the `HttpResponse` — or
from the `HttpErrorResponse` when the request fails. Useful for a `201 Created` with a
`Location` header, or to branch on a `409`/`422` error:

```html
@if (createUser.statusCode() === 201) {
  <p>Created at {{ createUser.headers()?.get('Location') }}</p>
}
```

`uploadProgress`, `downloadProgress`, `statusCode` and `headers` reset to `undefined` when a
call's request starts, and on `reset()`, and — like `value`/`status` — only reflect the current
call: a superseded call's events are ignored (see [stale-response guarding](../README.md#stale-response-guarding)).

With `concurrency: 'queue'`, a request only starts once the previous one settles, and these
signals follow the request actually in flight: while an older upload is still running with a
newer call queued behind it, `uploadProgress` shows the older upload's progress (its outcome will
still be ignored). They reset as soon as the queued request starts.

`error()` is typed `unknown` by default. It is an `HttpErrorResponse` for HTTP failures, but an
interceptor may throw anything else — pass `TError` explicitly if you rely on it:
`httpMutation<CreateUserDto, User, HttpErrorResponse>(...)`.

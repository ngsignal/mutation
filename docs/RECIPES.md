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

`onSuccess` runs for every successful call, superseded or not, so the last reload always follows
the last write to land.

### Optimistic updates

`resource().value` is a `WritableSignal`: update it immediately, roll back in `.catch()`
(`mutate()` always rejects like `mutationFn` does, for that specific call):

```ts
readonly deleteUser = mutation<User, void>({
  mutationFn: (user, signal) => this.api.deleteUser(user.id, signal),
});

removeUser(user: User) {
  this.usersResource.update((users) => users.filter((u) => u.id !== user.id));

  this.deleteUser.mutate(user).catch(() => this.usersResource.update((users) => [...users, user]));
}
```

Roll back the failed item, not a snapshot of the list: deletes can overlap (see
[stale-response guarding](../README.md#stale-response-guarding)), and a snapshot would also bring
back users whose delete succeeds. The restored user comes back at the end of the list.

## Retrying writes

There is no `retry` option: whether a failed write is safe to retry depends on your API. A `429`
or `503` means the server refused the request, so retrying is safe. A timeout or a `502`/`504`
may come after the write was applied, and needs an idempotency key on the server side.

If you retry inside `mutationFn`, pass its `AbortSignal` to the wait between attempts, otherwise
`reset()` and destroy won't stop the loop.

With `httpMutation()`, put the idempotency key in `input` rather than generating it in
`request()`: `request()` runs on every `mutate()`, so a key generated there changes when the user
clicks again.

## Submitting a Signal Form

`submit()` calls its action only when the form is valid, ignores a second submit while one runs,
and shows the errors the action returns on their fields. Call the mutation inside that action:

```ts
readonly model = signal<SignUp>({ email: '', password: '' });
readonly signUpForm = form(this.model, (path) => {
  required(path.email);
  required(path.password);
});

readonly signUp = mutation<SignUp, User>({
  mutationFn: (dto, signal) => this.api.signUp(dto, signal),
});

save() {
  void submit(this.signUpForm, async (f) => {
    try {
      await this.signUp.mutate(f().value());
      return undefined;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email-taken') {
        return { kind: 'server', fieldTree: f.email, message: 'This email is already used' };
      }
      return { kind: 'server', message: 'Sign-up failed, try again' };
    }
  });
}
```

```html
<form (submit)="$event.preventDefault(); save()">
  <input type="email" [formField]="signUpForm.email" />
  @for (error of signUpForm.email().errors(); track error) {
    <p>{{ error.message }}</p>
  }
  <input type="password" [formField]="signUpForm.password" />
  @for (error of signUpForm().errors(); track error) {
    <p>{{ error.message }}</p>
  }
  <button type="submit" [disabled]="signUpForm().submitting()">Sign up</button>
</form>
```

The form owns the submission: `submitting()` disables the button, and each returned error shows
on the field it names, or on the form if it names none. The mutation owns the write: it aborts
on destroy, holds SSR until it settles, and exposes the result and the error to the rest of the
page.

Return errors, don't throw them: the return value is how the form learns what failed. The form
already blocks a second submit, so `concurrency: 'drop'` only matters if the mutation is also
called from elsewhere.

Signal Forms are stable since Angular 22. On Angular 21 they are experimental and the API may
differ.

<a id="using-httpclient"></a>

## Testing a component

Every call in flight registers with Angular's `PendingTasks`, so `fixture.whenStable()` waits
for it to settle and for the view to update. No fake timers, no polling:

```ts
it('shows the created todo', async () => {
  const fixture = TestBed.createComponent(NewTodoComponent);
  await fixture.whenStable();

  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();

  expect(fixture.nativeElement.textContent).toContain('Milk');
});
```

With `httpMutation()` and `HttpTestingController`, flush the request **before** awaiting
`whenStable()`: the pending request keeps the app unstable, so awaiting first never resolves.

```ts
fixture.nativeElement.querySelector('button').click();
TestBed.inject(HttpTestingController).expectOne('/api/users').flush({ name: 'Ada' });
await fixture.whenStable();
```

To test a mutation without a component, create it with `TestBed.runInInjectionContext()` and
await `mutate()`.

## Using Observables and HttpClient

Pick the variant matching what you already have (see [the table](../README.md#rxmutation--httpmutation)).
Both accept the same `onSuccess`/`onError`/`onSettled`/`concurrency`/`injector` options as
`mutation()` — see [the main README](../README.md#features) for what each does.

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

That unsubscribe cancels whatever the Observable would have done next. A value emitted before
the request (`startWith(placeholder)`, `concat(of(placeholder), request$)`) resolves the call and
cancels the request, which may already have been sent. For an optimistic value, see
[Optimistic updates](#optimistic-updates) instead.

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
Handle it as a contract mismatch, not as a failed write — retrying would write twice (see
[Retrying writes](#retrying-writes)). For a
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
still be ignored). They reset as soon as the queued request starts. `input()` follows the latest
call, not the request in flight: read `pendingInputs()[0]` to label the progress bar.

`error()` is typed `unknown` by default. It is an `HttpErrorResponse` for HTTP failures, but an
interceptor may throw anything else — pass `TError` explicitly if you rely on it:
`httpMutation<CreateUserDto, User, HttpErrorResponse>(...)`.

# Recipes

Patterns built on top of the primitive. What each option and member does is in the
[API reference](./API.md).

## Working with resource

A mutation has no cache and never touches a resource for you.

### Refreshing a resource after a mutation

```ts
readonly usersResource = resource({
  loader: ({ abortSignal }) => this.api.fetchUsers(abortSignal),
});

readonly createUser = mutation<string, User>({
  mutationFn: (name, abortSignal) => this.api.createUser(name, abortSignal),
  onSuccess: () => this.usersResource.reload(),
});
```

Every successful call reloads, superseded or not, so the last reload follows the last write.

### Optimistic updates

The simplest optimistic view is a `computed` that hides the users being deleted, read from
`pendingInputs()`, and removes each one from the resource once its delete succeeds:

```ts
readonly deleteUser = mutation<User, void>({
  mutationFn: (user, abortSignal) => this.api.deleteUser(user.id, abortSignal),
  onSuccess: (_output, user) => this.usersResource.update((users) => users.filter((u) => u.id !== user.id)),
});

readonly visibleUsers = computed(() => {
  const deleting = new Set(this.deleteUser.pendingInputs().map((user) => user.id));
  return this.usersResource.value().filter((user) => !deleting.has(user.id));
});
```

Nothing to roll back: a failed delete leaves the pending list and the user shows again, in place.
The user never flashes back on success, because a call leaves the pending list in the same task
as its success callback. For a create, render the pending inputs as extra rows. React's
`useOptimistic` follows the same idea.

Update the resource in `onSuccess` rather than `reload()` it: the row would show again until the
reload ends.

For an update, fold the pending inputs over the resource. They are in call order, so the latest
rename wins:

```ts
const rename = (users: User[], { id, name }: User) => users.map((u) => (u.id === id ? { ...u, name } : u));

readonly renameUser = mutation<User, User>({
  mutationFn: (user, abortSignal) => this.api.renameUser(user, abortSignal),
  onSuccess: (renamed) => this.usersResource.update((users) => rename(users, renamed)),
  concurrency: 'queue',
});

readonly visibleUsers = computed(() =>
  this.renameUser.pendingInputs().reduce(rename, this.usersResource.value()),
);
```

Queue the renames: in parallel, one landing last would write an older name in `onSuccess`.

With one call in flight at most (`'drop'`, a disabled button), `input()` is enough. It outlives
the call, so check `status()`:

```ts
readonly title = computed(() => {
  const pending = this.rename.status() === 'pending' ? this.rename.input() : undefined;
  return pending?.title ?? this.todo.value().title;
});
```

When other code reads the resource itself, update it right away and roll back on failure. Roll
back only a write that can't have been applied: one that was never sent, or one the server
refused. A call aborted in flight may have reached the server.

```ts
removeUser(user: User): void {
  this.usersResource.update((users) => users.filter((u) => u.id !== user.id));

  this.deleteUser.mutate(user).catch((error: unknown) => {
    const refused = error instanceof HttpErrorResponse && error.status >= 400;
    if (wasNeverSent(error) || refused) this.usersResource.update((users) => [...users, user]);
  });
}
```

Restore the failed user, not a snapshot of the list: deletes overlap, and a snapshot would bring
back users whose delete succeeded. The restored user comes back at the end of the list.

## Ordering writes across mutations

The queue mode orders the calls of one mutation, but writes to the same data often come from
several: renaming a todo on blur, then deleting it. The click on delete blurs the input first, so
the PATCH leaves just before the DELETE; sent in parallel, the DELETE can land first and the
PATCH fails with a 404. Give both mutations the same queue:

```ts
@Injectable({ providedIn: 'root' })
export class TodoWrites {
  readonly queue = mutationQueue();
}

export class TodoList {
  private readonly writes = inject(TodoWrites);

  readonly rename = httpMutation<{ id: string; title: string }, Todo>({
    request: ({ id, title }) => ({ method: 'PATCH', url: `/api/todos/${id}`, body: { title } }),
    concurrency: this.writes.queue,
  });

  readonly remove = httpMutation<string, void>({
    request: (id) => ({ method: 'DELETE', url: `/api/todos/${id}` }),
    concurrency: this.writes.queue,
  });
}
```

The queue lives in a service so every component writing todos shares it. At module level, it
would also be shared by every SSR request.

To order writes per entity, give a key: the saves of one document stay in order, the other
documents save at once. A mutation on the same queue without a key waits for every key, like a
"delete all":

```ts
private readonly docWrites = mutationQueue();

readonly save = httpMutation<{ docId: string; content: string }, Doc>({
  request: ({ docId, content }) => ({ method: 'PUT', url: `/api/docs/${docId}`, body: { content } }),
  concurrency: { queue: this.docWrites, key: (draft) => draft.docId },
});

readonly removeAll = httpMutation<void, void>({
  request: () => ({ method: 'DELETE', url: '/api/docs' }),
  concurrency: this.docWrites,
});
```

Pitfalls:

- **Deadlock**: a `mutationFn` that calls a mutation of its own queue and waits for it never
  settles, and neither does SSR. Chain it from `onSuccess` instead, or call both and let the queue
  order them.
- **Hung request**: a call that never settles holds the queue for every mutation sharing it, even
  after a reset. Pass the abort signal on to the request and bound it with a timeout: `timeout` in
  the request description, or with `fetch()`:

  ```ts
  mutationFn: async (draft, abortSignal) => {
    const response = await fetch(`/api/docs/${draft.docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`PUT failed with ${response.status}`);
  },
  ```

- **Dependent writes**: a failed call doesn't block the queue. When the next one depends on it,
  make its request throw. Since the request is built when the call leaves the queue, a PATCH
  queued behind the POST that creates its entity can read the id the POST stored on success.
- **Reset**: a reset only rejects the mutation's own calls; the other mutations' calls stay
  queued.
- **Several tabs or users**: a queue only orders the writes of one tab. Have the server check a
  version (`ETag` and `If-Match`).

## Choosing settings by HTTP method

[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods) calls a method
idempotent when sending a request twice leaves the server as sending it once. That decides what
to do when a write may have been applied without a response coming back (a timeout, a 502 or 504,
an aborted call). Idempotent writes still change the server, so they still need a mutation.

| Method | Idempotent | Concurrency                                                     | When the write may have been applied |
| ------ | ---------- | --------------------------------------------------------------- | ------------------------------------ |
| PUT    | Yes        | `'queue'`, or a keyed queue per entity                          | Send it again                        |
| DELETE | Yes        | `'parallel'`: a duplicate only gets a 404                       | Send it again, count a 404 as done   |
| POST   | No         | `'drop'` for a form submit, `'parallel'` for independent creations | Only with an idempotency key      |
| PATCH  | It depends | `'queue'`, or a keyed queue per entity                          | Only if it sets values rather than adding to them, or with an idempotency key |

Idempotent doesn't mean order-free: of two PUTs with different bodies, the last one to land wins.
Queue the writes to the same data, idempotent or not.

## Retrying writes

There is no retry option, because whether a write is safe to retry depends on its method and your
API:

- A 429 or 503 means the server refused the request: retry, after the `Retry-After` delay when
  there is one.
- A timeout, a 502 or a 504 may come after the write was applied: send a PUT or DELETE again, but
  a POST only with an idempotency key (see [the table above](#choosing-settings-by-http-method)).

When retrying inside `mutationFn`, pass the abort signal to the wait between attempts, or a reset
won't stop the loop. In parallel mode, a retried PUT can overwrite a newer one: in queue mode, the
next call waits for the retries.

With `httpMutation()`, put the idempotency key in the input, not in the request description: the
description is built again on every call, so a key generated there changes when the user clicks
again.

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
  mutationFn: (dto, abortSignal) => this.api.signUp(dto, abortSignal),
});

save(): void {
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

The form owns the submission: it disables the button and shows each returned error on its field.
The mutation owns the write: it aborts on destroy, holds SSR and exposes the result to the rest of
the page. Return errors rather than throwing them, since that's how the form learns what failed.
The form already blocks a second submit, so the drop mode only matters if the mutation is also
called from elsewhere.

With `httpMutation()`, the server's error body (e.g. a 422's field errors) is the `error` property
of the `HttpErrorResponse`, typed `any`: check its shape before mapping it to fields.

Signal Forms are stable since Angular 22, experimental on Angular 21.

## Testing a component

A call in flight keeps the app unstable, so `fixture.whenStable()` waits for it to settle and for
the view to update. No fake timers, no polling:

```ts
it('shows the created user', async () => {
  const fixture = TestBed.createComponent(NewUserComponent);
  await fixture.whenStable();

  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();

  expect(fixture.nativeElement.textContent).toContain('Ada');
});
```

With `HttpTestingController`, flush the request **before** awaiting stability, which would
otherwise never come:

```ts
fixture.nativeElement.querySelector('button').click();
TestBed.inject(HttpTestingController).expectOne('/api/users').flush({ name: 'Ada' });
await fixture.whenStable();
```

To test a mutation without a component, create it in `TestBed.runInInjectionContext()` and await
`mutate()`.

<a id="using-httpclient"></a>

## Using Observables and HttpClient

Pick the variant matching what you already have (see
[the table](./API.md#rxmutation--httpmutation)). Both take the same callbacks and concurrency
options as `mutation()`.

### Reusing an Observable-returning service

`rxMutation()` takes any Observable: an existing service, a generated API client, a raw
`HttpClient` call.

```ts
import { rxMutation } from '@ngsignal/mutation/rxjs-interop';

readonly createUser = rxMutation<CreateUserDto, User>({
  mutationFn: (dto) => this.userService.create(dto),
});
```

The call resolves with the last value once the Observable completes. If it may never complete,
add a timeout, or it stays pending until a reset:

```ts
import { timeout } from 'rxjs/operators';

readonly saveSettings = rxMutation({
  mutationFn: (settings: Settings) => this.settingsFacade.save(settings).pipe(timeout(10_000)),
});
```

### Describing an HTTP request

`httpMutation()` takes the same request description as `httpResource()`, with a required
`method`. It sends it through `HttpClient`, so interceptors apply. Requires `provideHttpClient()`.

```ts
import { httpMutation } from '@ngsignal/mutation/http';

readonly createUser = httpMutation<CreateUserDto, User>({
  request: (dto) => ({ method: 'POST', url: '/api/users', body: dto }),
});
```

A response without a body (a 204 on a DELETE) resolves with `null`, as with `httpResource()`:
declare the output type as `null`, or `User | null`.

The description is built when the request is sent, not when `mutate()` is called: in queue mode,
that's when the call leaves the queue. Signals it reads (an auth token, an `ETag`) are read then;
pass values through the input to freeze them earlier.

### Validating the response

`parse` validates or transforms the body before it resolves the call, like `httpResource()`'s.
Its return type becomes the output type, so it pairs with a schema library:

```ts
readonly createUser = httpMutation({
  request: (dto: CreateUserDto) => ({ method: 'POST', url: '/api/users', body: dto }),
  parse: (raw) => UserSchema.parse(raw), // value: Signal<User | undefined>
});
```

If `parse` throws, the call fails with an `HttpMutationParseError` whose `cause` is the original
error. **The server has already applied the write**: don't retry it. For a 204, `parse` receives
`null`.

### Non-JSON responses

Like `httpResource()`, three variants read the body differently, e.g. for a write that returns a
generated file:

```ts
readonly exportInvoice = httpMutation.blob<number>({
  request: (id) => ({ method: 'POST', url: `/api/invoices/${id}/pdf` }),
}); // value: Signal<Blob | undefined>
```

| Variant                      | Body          | `parse`                                   |
| ---------------------------- | ------------- | ----------------------------------------- |
| `httpMutation()`             | JSON          | optional                                  |
| `httpMutation.text()`        | `string`      | required unless the output is a `string`  |
| `httpMutation.blob()`        | `Blob`        | required unless the output is a `Blob`    |
| `httpMutation.arrayBuffer()` | `ArrayBuffer` | required unless the output is an `ArrayBuffer` |

### Requests that must outlive the component

Destroying the injection context cancels the requests in flight, so navigating away from a
component cancels its writes. `keepalive: true` doesn't help: it only survives a page unload, and here the app itself
cancels. For a write that must complete anyway (a "save on leave"), create the mutation in a
root service, or with `injector: inject(EnvironmentInjector)`.

### Upload progress

Set `reportProgress: true` to fill the upload and download progress signals:

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

Upload progress needs the XHR backend, the default on Angular 21. Angular 22 switched to `fetch`,
which ignores it for uploads: the signal silently stays `undefined` unless you opt back in.
(Angular 22's `reportUploadProgress` would throw NG02824 instead, but the request description only
accepts `reportProgress`.)

```ts
provideHttpClient(withXhr()) // Angular 22+, only for upload progress
```

### Status code and headers

The status code and headers come from the response, or from the error response when the request
fails. Useful for a 201 with a `Location` header, or to branch on a 409 or 422:

```html
@if (createUser.statusCode() === 201) {
  <p>Created at {{ createUser.headers()?.get('Location') }}</p>
}
```

- A 202 is a success, but the server has only
  [queued the write](https://www.rfc-editor.org/rfc/rfc9110.html#name-202-accepted): check the
  status before telling the user it's done.
- Cross-origin, the browser hides most headers, `Location` included, unless the server lists them
  in `Access-Control-Expose-Headers`.
- The signals keep only the latest call. The callbacks get each call's response:

  ```ts
  onSuccess: (user, dto, { response }) => this.created.push(response?.headers.get('Location')),
  ```

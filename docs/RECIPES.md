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

## Using HttpClient

`mutationFn` expects `(input, abortSignal) => Promise<TOutput>` while `HttpClient` returns an
`Observable`. Bridge the two by subscribing manually and wiring the abort signal to
`unsubscribe()`, so cancellation still works:

```ts
function fromHttp<T>(source: Observable<T>, abortSignal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const sub = source.subscribe({ next: resolve, error: reject });
    abortSignal.addEventListener('abort', () => {
      sub.unsubscribe();
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

readonly createUser = mutation<string, User>({
  mutationFn: (name, signal) => fromHttp(this.http.post<User>('/api/users', { name }), signal),
});
```

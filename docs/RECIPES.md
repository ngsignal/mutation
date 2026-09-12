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

Use `onSuccess` (or an `effect()` on `status()`), not `.then()` on `mutate()`. The returned
promise settles even for a call that [automatic
cancellation](../README.md#automatic-cancellation-of-stale-mutations) already discarded, so it resolves with the
real value or `undefined` (never rejects) if `mutationFn` fails.

### Optimistic updates

`resource().value` is a `WritableSignal`: update it immediately, roll back in `.catch()`
(`mutate()` rejects like `mutationFn` does, as long as this call hasn't been
[superseded](#refreshing-a-resource-after-a-mutation) by a newer one):

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

`deleteUser` is one shared instance, so two `removeUser` calls in a row cancel the first delete
(same [automatic cancellation](../README.md#automatic-cancellation-of-stale-mutations)). For independent
concurrent operations, use one `mutation()` per operation instead.

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

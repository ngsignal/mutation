<div align="center">

<img src="./mutation-icon.svg" alt="@ngsignal/mutation" width="120" height="120">

# @ngsignal/mutation

An Angular low-level Signal-based primitive for mutations<br>
POST · PUT · PATCH · DELETE

<a href="https://ngsignal.github.io/mutation/"><img src="https://img.shields.io/badge/%F0%9F%9A%80%20Live%20demo-AB2599?style=for-the-badge" alt="Live demo" height="32"></a>
<a href="https://stackblitz.com/github/ngsignal/mutation/tree/demo/examples/demo"><img src="https://img.shields.io/badge/Open%20in%20StackBlitz-4823DD?style=for-the-badge&logo=stackblitz&logoColor=white" alt="Open in StackBlitz" height="32"></a>

[API reference](./docs/API.md) · [Recipes](./docs/RECIPES.md) · [Architecture](./docs/ARCHITECTURE.md) · [Roadmap](./docs/ROADMAP.md)

[![CI](https://github.com/ngsignal/mutation/actions/workflows/ci.yml/badge.svg)](https://github.com/ngsignal/mutation/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ngsignal/mutation/actions/workflows/codeql.yml/badge.svg)](https://github.com/ngsignal/mutation/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/%40ngsignal%2Fmutation.svg)](https://www.npmjs.com/package/@ngsignal/mutation)
[![license](https://img.shields.io/npm/l/%40ngsignal%2Fmutation.svg)](./LICENSE)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ngsignal/mutation/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ngsignal/mutation)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16728/badge)](https://www.bestpractices.dev/projects/16728)

</div>

## Why

With signals, Angular turns async work into state you read in templates: `resource()` exposes a
read's status, value and error. Writes, the side effects on the server, have no equivalent:
`resource()` is [meant for reads](https://angular.dev/api/core/resource) and would abort them.

`mutation()` brings the same model to writes: each call goes through a small state machine
(idle, pending, success or error) exposed as signals, and returns a promise. It stays a
primitive: no cache, no retry, and [recipes](./docs/RECIPES.md) for the rest.

## Install

```bash
npm install @ngsignal/mutation
```

Requires Angular 21 or 22.

## Quick start

```ts
import { Component, inject, signal } from '@angular/core';
import { mutation } from '@ngsignal/mutation';

@Component({
  selector: 'app-new-user',
  template: `
    <input #name />
    <button (click)="create({ name: name.value })" [disabled]="createUser.isPending()">Create</button>
    @if (createUser.error(); as error) {
      <p role="alert">{{ error }}</p>
    }
  `,
})
export class NewUserComponent {
  private readonly api = inject(UserApi);
  readonly users = signal<User[]>([]);

  readonly createUser = mutation<NewUser, User>({
    mutationFn: (user, abortSignal) => this.api.createUser(user, abortSignal),
    onSuccess: (created) => this.users.update((list) => [...list, created]),
  });

  create(user: NewUser): void {
    this.createUser.mutate(user);
  }
}
```

`mutate()` also returns a promise of the result, for `await` at the call site.

## Features

### No lost writes

A new call never aborts the previous one: its write may already have reached the server. The
signals follow the latest call, and every call runs its callbacks, `isLatest` telling them apart.

<img src="./docs/assets/stale-response.gif" alt="A double click: both calls complete, the state shows the latest, both run onSuccess" width="640">

### Concurrency, per entity

`'parallel'` by default, `'queue'` to keep submission order, `'queue-latest'` to send only the
latest waiting call (autosave), `'drop'` against double submits.
A `mutationQueue()` orders writes across mutations, and a key gives one queue per entity: the
saves of one document stay in order, the other documents save at once.

```ts
private readonly docWrites = mutationQueue();

readonly save = mutation<Draft, Doc>({
  mutationFn: (draft, abortSignal) => this.api.save(draft, abortSignal),
  concurrency: { queue: this.docWrites, key: (draft) => draft.docId },
});
```

### HttpClient, with progress

`httpMutation()` takes a request description, like `httpResource()`, and exposes the status
code, the headers and the upload and download progress as signals. `rxMutation()` takes any
Observable, e.g. an existing service. Upload progress needs `withXhr()` on Angular 22: see
[the recipe](./docs/RECIPES.md#upload-progress).

```ts
readonly uploadAvatar = httpMutation<File, User>({
  request: (file) => ({ method: 'POST', url: '/api/avatar', body: file, reportProgress: true }),
});
```

```html
@if (uploadAvatar.uploadProgress(); as p) {
  <progress [value]="p.loaded" [max]="p.total"></progress>
}
```

### And also

- **Per-row pending state**: `pendingInputs()` lists the inputs of every call in flight, so one
  mutation can drive a whole list.
- **Safe rollbacks**: `reset()` or destroy aborts the calls in flight, and `wasNeverSent(error)`
  tells whether a write may have reached the server.
- **Typed state**: `snapshot()` as a discriminated union for `@switch`, `hasValue()` as a type
  guard.
- **SSR-ready, no dependencies**: calls in flight hold `PendingTasks`. RxJS and
  `@angular/common` are optional peers, loaded only by the secondary entry points.

Every option and member is in the [API reference](./docs/API.md). The [recipes](./docs/RECIPES.md)
cover optimistic updates, Signal Forms, testing and more.

## Status

Experimental (0.x): minor releases may include breaking changes, called out in the
[CHANGELOG](./CHANGELOG.md). Pin an exact version. What is planned before 1.0 is in the
[roadmap](./docs/ROADMAP.md).

## Contributing

Issues and PRs are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

# Testing

Vitest + jsdom, global setup in `setup-vitest.ts`, one spec file per source file
(`src/*.spec.ts`). Adapter specs must run on RxJS 6 too: use `src/testing/rxjs.ts`
(`failWith`, `isObserved`), and `npm run test:rxjs6` after `npm install --no-save rxjs@6`.
Tests use `TestBed` for an injection context, and
`runInInjectionContext` or an explicit `injector` when the call happens outside one.

Unit specs use `HttpClientTestingBackend`, which hides backend differences. The one exception
to "one spec file per source file" is `*.integration.spec.ts`: real requests to the local server
of `src/testing/http-test-server.ts`, through Angular's actual `FetchBackend` and
`HttpXhrBackend` (Node's fetch, jsdom's XHR). Add a case there for anything that depends on the
backend (progress, abort, response types), and a route to the server if needed. They run with
`npm test`, so on every Angular version of the CI matrix.

When touching the lifecycle, cover it explicitly:

- supersession: a superseded call's result must not land in the signals, and its
  callbacks must not fire;
- `reset()` during flight and destroy during flight (the signal is aborted, the task released);
- `onSuccess` / `onError` / `onSettled` fire exactly once, in that order;
- pending-task release (`ApplicationRef.isStable`);
- each `concurrency` mode (`'queue'` ordering and aborted-while-queued, `'drop'` rejection);
- the promise returned by `mutate()`: it rejects for awaiting callers, and produces no
  unhandled rejection when ignored.

ESLint enforces the spec rules (no `.skip` / `.only`, every test asserts).

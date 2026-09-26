# CLAUDE.md

## What this project is

`@ngsignal/mutation` is a **low-level, Signal-based Angular primitive for mutations**
(POST/PUT/DELETE). Angular's `resource()` / `httpResource()` cover reads only: they abort
in-flight loads, which would kill a write. This package fills that gap with one core
function, `mutation()`, plus two thin adapters mirroring `rxResource()` / `httpResource()`:
`rxMutation()` and `httpMutation()`, in secondary entry points. Keeping it small is the
point, and it is meant to inform the Angular RFC.

### Non-goals (do not implement without an explicit request)

- No cache, query keys, automatic `resource()` invalidation, retry, or de-duplication.
- No idempotency handling: that belongs to the caller's HTTP layer.
- No runtime dependency. `@angular/core` is the only required peer. RxJS and `HttpClient`
  are allowed only in the secondary entry points (`@ngsignal/mutation/rxjs-interop`,
  `@ngsignal/mutation/http`), backed by the optional peers `rxjs` and `@angular/common`.
  The main entry must never import them: `src/index.spec.ts` guards this.
- The default answer to "should this be an option?" is no: write a recipe in
  `docs/RECIPES.md` instead.

## Commands

```bash
npm run lint && npm run typecheck && npm test && npm run build   # all four before "done" (= CI = prepack)
npm run check:exports   # publint + are-the-types-wrong, run when touching exports/imports
npm run test:rxjs6      # suite on RxJS 6, after `npm install --no-save rxjs@6` (CI job rxjs-compat)
```

## Layout

```
src/index.ts            # main entry `@ngsignal/mutation`: mutation() and its types only
src/rxjs-interop.ts     # entry `@ngsignal/mutation/rxjs-interop`: rxMutation()
src/http.ts             # entry `@ngsignal/mutation/http`: httpMutation()
src/mutation.ts         # the primitive
src/mutation.types.ts   # public types, shipped as .d.ts: changing them is an API change
src/rx-mutation.ts      # rxMutation() and its public types
src/http-mutation.ts    # httpMutation() and its public types
src/internal/           # helpers shared by the adapters, never exported from an entry point
src/testing/            # spec helpers, excluded from the build
src/*.spec.ts           # one spec file per source file
docs/ARCHITECTURE.md    # design rationale, comparison with TanStack Query
docs/RECIPES.md         # userland patterns (resource refresh, optimistic updates, …)
```

`src/` is the source of truth; README and docs can drift during `0.x`. Flag mismatches
instead of copying the README.

## Hard constraints

1. **No Angular decorators in `src/`**: the build is plain `tsc`, no Angular compiler.
2. **Relative imports end in `.js`** (`from './mutation.types.js'`). `moduleResolution:
   bundler` won't flag a missing extension, but consumers' Node ESM resolver will fail.
3. **`sideEffects: false`**: no module-level side effects or allocations.
4. **Peer range `@angular/core` ^21 || ^22**: no API newer than Angular 21 without
   bumping the range and saying so.
5. **No new dependencies**, dev or runtime, unless explicitly asked (`rxjs` and
   `@angular/common` are already optional peers + devDependencies for the adapters).
6. **Never log or attach `input` payloads** (they carry credentials/PII), and surface
   `error` to the caller as-is.
7. Workflows, `.npmrc` and publish config are trust-sensitive: no drive-by changes.
8. **One subpath per optional peer.** A new entry point needs its `src/<name>.ts` barrel and
   an `exports` entry in `package.json`; never re-export it from `src/index.ts`. Don't rely
   on `sideEffects` to keep optional peers out: unbundled consumers (Vitest, Jest, Node,
   SSR dev) execute every import of the entry they load.
9. **RxJS 6.5 and 7 alike** (the `rxjs` peer range, same as Angular): in the adapters and
   their specs, only the `Observable` class and `.subscribe()`. No `firstValueFrom` /
   `lastValueFrom`, no operators imported from the `'rxjs'` root (7.2+): subscribe by hand.
   In specs use `src/testing/rxjs.ts` (`failWith`, `isObserved`). The CI job `rxjs-compat`
   runs the suite on RxJS 6. Once Angular drops RxJS 6, narrow the peer to Angular's range,
   restore `firstValueFrom` and root-level operators, and remove `src/testing/rxjs.ts` and
   the `rxjs-compat` CI job.

## Public API changes

Any change to options, returned signals, exported types or semantics:

- add a test in the matching `src/*.spec.ts`: new behavior without a test is not done;
- update `README.md` and, if affected, `docs/`;
- add a `CHANGELOG.md` entry (`0.x`: patch = fixes only, minor may break; breaking first);
- never bump the version or publish (`.github/workflows/publish.yml` does that).

## Working style

- Smallest diff; match the surrounding style.
- Concurrency, cancellation and error semantics are deliberate design decisions: ask
  rather than guess, and say explicitly when a change trades correctness, types, bundle
  size or API surface against each other.

## Read when relevant

- `agent_docs/editing-mutation.md` before touching `src/mutation.ts`: lifecycle
  invariants and what to argue in a review
- `agent_docs/testing.md` before writing or changing tests

# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## What this project is

`@ngsignal/mutation` is a **low-level, Signal-based Angular primitive for mutations**
(POST/PUT/DELETE — the non-safe HTTP verbs). Angular's `resource()` / `httpResource()`
deliberately cover reads only: they abort in-flight loads via `AbortSignal`, which would
prematurely kill a write. This package fills that gap.

It is a **single-primitive library**: one exported function, `mutation()`. Keeping it small
is the point, not an accident.

### Non-goals (do not implement without an explicit request)

- No cache, no query-key registry, no automatic `resource()` invalidation.
- No retry / backoff policy, no request de-duplication.
- No idempotency handling (`Idempotency-Key` headers, replay protection) — that belongs to
  the caller's HTTP layer; `mutation()` only owns the *lifecycle* of a call.
- No RxJS, no `HttpClient` coupling, no runtime dependencies. `@angular/core` is a
  **peer** dependency, nothing else.
- Nothing that requires `ng-packagr`. The build is plain `tsc`.

## Commands

```bash
npm install
npm run lint          # eslint src
npm run typecheck     # tsc -p tsconfig.spec.json
npm test              # vitest run
npm run test:watch    # vitest
npm run build         # tsc -p tsconfig.build.json  -> dist/
npm run check:exports # publint + are-the-types-wrong (esm-only profile)
```

CI runs lint + typecheck + test + build. **Run all four before declaring work done** —
the same set is wired into `prepack`.

## Layout

```
src/index.ts            # public barrel — the entire public surface
src/mutation.ts         # the primitive (~130 LOC)
src/mutation.types.ts   # MutationOptions / MutationRef / MutationSnapshot / MutationStatus
src/mutation.spec.ts    # the whole test suite, single file
docs/ARCHITECTURE.md    # implementation rationale, comparison with TanStack Query
docs/RECIPES.md         # resource refresh, optimistic updates, Observable -> Promise bridge
```

## Hard constraints

1. **No Angular decorators anywhere in `src/`** (`@Injectable`, `@Component`, `@Directive`,
   `@Pipe`, `@NgModule`, parameter decorators). The package is compiled with plain `tsc`,
   which does not run the Angular compiler.
2. **ESM only (`"type": "module"`), shipped as raw `tsc` output.** `moduleResolution` is
   `bundler`, so TypeScript will *not* flag a missing extension — but relative imports must
   still carry `.js` (`from './mutation.types.js'`). Node's ESM resolver does no extension
   search, so omitting it type-checks fine and breaks for consumers at runtime.
   `npm run check:exports` (publint + are-the-types-wrong) is the guard.
3. **`sideEffects: false`** — never introduce module-level side effects.
4. **Peer range is `@angular/core` ^21 || ^22**, Node >= 20. Do not use APIs newer than
   Angular 21 without bumping the peer range and saying so in the PR.
5. **No new dependencies**, dev or runtime, unless explicitly asked.

## Implementation invariants

`mutation()` is modelled on Angular core's `resource.ts`. These four mechanisms are the
load-bearing parts — understand them before editing `src/mutation.ts`:

- **Generation counter.** Every `mutate()` increments `generation`. A resolved or rejected
  call only writes to the signals if its captured generation still matches. This is what
  makes a superseded call silently drop instead of overwriting fresher state. `reset()` and
  `DestroyRef.onDestroy` also bump it.
- **`activeCalls: Map<AbortController, removeTask>`.** Starting a new call, resetting, or
  destroying aborts every in-flight controller and releases its pending task.
- **`PendingTasks`.** Each call registers a task so `ApplicationRef.isStable` (and therefore
  SSR) waits for it, and releases it immediately when superseded or reset rather than
  waiting for a dead request to settle. Every `pendingTasks.add()` needs its
  `removeTask()` in a `finally`.
- **`untracked()`.** Status/error writes and the `mutationFn` invocation are wrapped so that
  calling `mutate()` from inside a reactive context never creates a dependency. Keep new
  signal writes inside `untracked` in that path.

State is held in three raw `WritableSignal`s (`status`, `value`, `error`), exposed read-only,
with `isPending` and the discriminated `snapshot` derived via `computed`. `value` keeps the
last successful result when a later call fails — only `reset()` or a new success clears it.

## Public API — treat as a contract

```ts
mutation<TInput, TOutput, TError = unknown>(options): MutationRef<...>
// options: mutationFn(input, abortSignal) => Promise<TOutput>, onSuccess?, onError?, onSettled?,
//          concurrency?, injector?
// ref:     status, value, error, input, isPending, isIdle, isSuccess, isError, snapshot,
//          hasValue(), mutate(input), reset()
```

`mutation()` calls `assertInInjectionContext` unless an `injector` is supplied.

Any change to option names, returned signals, exported types, or the semantics above is a
**public API change**:

- Add or update a test in `src/mutation.spec.ts` — new behavior without a test is not done.
- Update `README.md`, and `docs/RECIPES.md` / `docs/ARCHITECTURE.md` if they describe the
  changed behavior.
- Add a `CHANGELOG.md` entry. The project is `0.x`: patches are bug-fix only, minors may
  break the API, and breaking changes are called out at the top of the entry.
- Do not bump the version or publish; releases go through `.github/workflows/publish.yml`.

## Testing conventions

Vitest + jsdom, global setup in `setup-vitest.ts`. Tests use `TestBed` to obtain an injection
context and `runInInjectionContext` / an explicit `injector` where the call happens outside
one. Cover the lifecycle explicitly when touching it: supersession (result of the aborted
call must not land), `reset()` during flight, destroy during flight, `onSuccess`/`onError`
firing exactly once, and pending-task release.

## Review bar

This is a published, security-conscious library, not app code: it runs inside other people's
bundles, under SSR, on every consumer's install. Weigh every change on these axes, in this
order, and **say so explicitly when a change trades one for another**.

**Correctness of the reactive lifecycle first.** The subtle bugs here are ordering bugs, not
logic bugs: a stale call writing to the signals, a `PendingTasks` handle leaked so
`isStable` never fires (SSR hangs forever), a signal write escaping `untracked` and creating
a phantom dependency, an `AbortController` left in `activeCalls`. Any edit to `mutation.ts`
should be argued in terms of the generation counter and the pending-task ledger.

**TypeScript.** `strict: true`. Keep guarantees at the type level rather than re-checking at
runtime — `snapshot` is a discriminated union and `hasValue()` is a type predicate for that
reason; preserve that narrowing. `no-explicit-any` is a warning: do not add new ones, and
prefer a generic (`TError`) or `unknown` over widening. Public types live in
`mutation.types.ts` and are part of the shipped surface — a `.d.ts` change is an API change.

**Runtime and bundle cost.** Zero runtime dependencies, `sideEffects: false`, tree-shakeable
named export. Reject anything that adds a dependency, a module-level allocation, or a global
registry to the import path. The whole primitive is ~130 LOC; a feature that doubles it
probably belongs in userland (`docs/RECIPES.md`) rather than in the core.

**Security and supply chain.** CodeQL, OpenSSF Scorecard, Dependabot and a `SECURITY.md` are
already wired up — keep them green rather than working around them. Concretely: no new
transitive dependency without a stated reason, no `eval`/dynamic `import()` of non-literal
paths, never log or attach `input` payloads anywhere (they routinely carry credentials or
PII), and do not swallow an error into a generic message — `error` is surfaced to the caller
as-is, on purpose. Workflow files, `.npmrc` and publish config are trust-sensitive: treat any
change there as requiring explicit review, not a drive-by fix.

**API design.** Every option added is permanent surface in a pre-1.0 package whose stated
goal is to stay minimal and to inform the Angular RFC. The default answer to "should this be
an option?" is no — show the recipe instead.

### Lint-enforced conventions (don't fight them)

- Decorators are banned by a `no-restricted-syntax` rule, not just by convention.
- `consistent-type-imports`: type-only imports use `import type`.
- `import-x/order`: grouped, alphabetized, **no blank lines between groups**;
  `no-cycle` and `no-duplicates` are errors.
- Unused args must be prefixed `_`.
- In specs: no `.skip`, no `.only`, and every test must assert (`expect` / `expectTypeOf`).

## Working style in this repo

- Smallest diff that solves the problem; match the surrounding style rather than reformatting.
- Prefer clarifying a semantic question in an issue/discussion over guessing — cancellation
  and error-handling semantics are deliberate design decisions, not implementation details.
- When asked for a usage example, write it against the real API above and mention that
  `mutation()` does not touch any `resource()` for you; the caller wires that (see
  `docs/RECIPES.md`).
- README and source can drift during `0.x`. **`src/` is the source of truth** — verify
  signatures in `src/mutation.types.ts` before documenting them, and flag the mismatch
  instead of copying the README.
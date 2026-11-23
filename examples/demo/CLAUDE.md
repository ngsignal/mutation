# @ngsignal/mutation — demo app

Angular 22 app that teaches `@ngsignal/mutation` through small interactive examples.
Educational first: the library API must stay visible, never hidden behind architecture.

## Where things are

- Library: the repository root (`../..`)
  - source `src/core/mutation.ts`, `src/core/mutation.types.ts` · tests `src/core/mutation.spec.ts`
  - `rxMutation` (`@ngsignal/mutation/rxjs-interop`), `httpMutation` (`@ngsignal/mutation/http`)
  - docs `README.md`, `docs/RECIPES.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`
- Version running: `@ngsignal/mutation` from npm, pinned in `package.json` and bumped by
  Dependabot after each release. CI builds the demo against the library of the current commit
  instead, so a library change that breaks a page fails CI, and a page can use an API in the PR
  that adds it. Each release tag deploys its demo (`.github/workflows/demo-release.yml`): to
  GitHub Pages, built with the tag's library, and to the `demo` branch StackBlitz opens, pinned
  to the released version. To ship a demo-only change without a release, run that workflow by
  hand with `demo-ref: main`: it deploys main's demo, still built with the tag's library.
  The `.d.ts` files in `node_modules/@ngsignal/mutation/dist` are the ground truth.
- One demo = `src/app/demos/<name>-page/` (`.ts` + `.html`), registered in
  `src/app/app.routes.ts` and in the sidebar in `src/app/app.html`.
- Fake backends: `src/app/shared/fake-api.ts` (delayed promises, one fake server per demo so
  demos don't affect each other), `src/app/shared/fake-http-backend.ts` (`HttpInterceptorFn`).
  Each fake server logs what it receives in `requests()`: show that log rather than logging
  from the page. Log from the page only what it teaches (callbacks, `mutate()` rejections).
- A page that runs several demos renders one child component per demo, colocated in its folder,
  each wrapped in `<app-restartable>` (`src/app/shared/restartable.ts`): "Restart" recreates it,
  mutations and fake server included, instead of a hand-written reset.

## Commands

- `npm start` — dev server on http://localhost:4200
- `npm run build` — must pass before a task is done
- Try the library of the current branch: `npm run build && npm pack` at the root, then
  `npm install --no-save ../../ngsignal-mutation-<version>.tgz` here (as CI does).

## Rules

1. **The library is the source of truth.** Before demoing a feature, read the README and
   the installed implementation. Never infer behavior from other libraries (TanStack Query…).
2. **Never invent or simulate a library feature.** Label app-level patterns as such.
3. **Precise terminology.** No "cancellation" if the call keeps running; no
   "concurrency control" unless the code actually does that.
4. **Use the mutation's state, don't duplicate it** (no extra `isLoading` signal).
5. **Displayed code = executed code.**
6. **Deterministic demos**: local mocks, errors triggered by a button, artificial delays labeled.
7. If README and implementation disagree: report it, don't pick an interpretation.
   The demo is never the source of truth for library behavior.

## Navigation

Sidebar in `src/app/app.html`. It shows the installed library version, read from its
`package.json`.

## Read when relevant

- `agent_docs/adding-a-demo.md` — page layout, code-example rules, checklist
- `agent_docs/ui-guidelines.md` — UX, accessibility, responsive rules

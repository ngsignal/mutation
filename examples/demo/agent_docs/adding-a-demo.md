# Adding or changing a demo

## Checklist

1. Confirm the API exists in `node_modules/@ngsignal/mutation/dist/**/*.d.ts`.
2. Confirm how it behaves: README, then source, then tests when ambiguous
   (the repository root, `../..`).
3. Prefer extending an existing page: there is one page per concept, not per API member.
   Otherwise create `src/app/demos/<name>-page/<name>-page.ts` + `.html` (standalone, OnPush),
   ending the pitch with a "Source" link to the `.ts` on GitHub (one per child demo when the
   page has several).
4. Add the route in `src/app/app.routes.ts`, with a `data.description` (the page's meta
   description: under ~155 characters, accurate, naming the API and Angular), and the link in
   the right nav group of `src/app/app.ts` (`NAV_GROUPS`).
   The page is pre-rendered at build time: code that runs on creation must not need the
   browser (`window`, `document`, `localStorage`); keep it in event handlers or `afterNextRender`.
5. `npm run build`.

## What a demo should answer

Depending on the feature: what problem it solves, how to create / execute a mutation,
what state it exposes, how success, errors, the returned value and reset work, and
the relevant edge cases.

## Page layout

```text
Title
Short explanation · Source link

┌──────────────────────────────────────┐
│ Interactive example                  │
│ [ Action ]                           │
│ Current state                        │
│ Result / Error                       │
└──────────────────────────────────────┘

How it works
```

Keep it consistent across pages, but don't force it when it makes the concept harder
to understand.

## Keeping the API visible

The reader must immediately spot where the mutation is created, where its mutation
function is defined, where it is executed and where its state is consumed:

```text
User action → mutation.mutate(...) → mutationFn(...) → mutation state → UI
```

- No services, factories or wrappers that hide the API. Duplicating a few lines is fine.
- Show all observable state in the UI, not only in the console (including errors).
- Code: short, strongly typed, idiomatic Angular (signals, `inject()`, `@if`/`@for`,
  template reference variables, OnPush), copy-pastable.
- Readers copy everything: no `.catch(() => {})` around `mutate()` (ignoring its promise is
  safe), no state that duplicates the mutation's own (`input()`, `isPending()`), no side
  effects inside `mutationFn` (use callbacks), comments only where the code doesn't say it.
- Link to the library README instead of repeating it.
- To show a page's code, use `<app-code-block>` (`src/app/shared/code-block.ts`) with a region of
  the page's own template, imported as text and marked `<!-- #region name -->` … `<!-- #endregion -->`:
  the code shown is the code that runs, and a missing region fails the build.

# Adding or changing a demo

## Checklist

1. Confirm the API exists in `node_modules/@ngsignal/mutation/dist/**/*.d.ts`.
2. Confirm how it behaves: README, then source, then tests when ambiguous
   (the repository root, `../..`).
3. Prefer extending an existing page: there is one page per concept, not per API member.
   Otherwise create `src/app/demos/<name>-page/<name>-page.ts` + `.html` (standalone, OnPush),
   ending the pitch with a "Source" link to the `.ts` on GitHub (one per child demo when the
   page has several).
4. Add the route in `src/app/app.routes.ts` and the link in the right nav group of
   `src/app/app.html` (`mutation()` or "Adapters").
5. Translate: write the text in English with `i18n` on each sentence or label (`i18n-<attr>`
   for attributes, an ICU `select` instead of a text ternary, `$localize` in TS). Run
   `npm run extract-i18n`, then add or update each changed entry of
   `src/locale/messages.fr.json`. Logs of `log.add()` stay in English: they are code traces.
6. `npm run build`: it builds both languages and fails on a missing French translation.

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

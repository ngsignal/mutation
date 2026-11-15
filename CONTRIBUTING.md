# Contributing

Thanks for considering a contribution to `@ngsignal/mutation`.

## Setup

```bash
npm install
npm test
```

## Workflow

- `npm run lint`
- `npm run typecheck`
- `npm run test:coverage`
- `npm run build`

Please make sure all four pass before opening a PR (CI runs the same checks).
Coverage must stay at 100%: CI fails on any uncovered line or branch.

## Guidelines

- Keep `mutation()` low-level and dependency-free. RxJS and `HttpClient` belong only in the
  secondary entry points (`@ngsignal/mutation/rxjs-interop`, `@ngsignal/mutation/http`).
- New behavior and bug fixes must come with a test in the matching `src/*.spec.ts`.
- Match the existing code style.
- **No Angular decorators** (`@Injectable`, `@Directive`, `@Component`, `@Pipe`, `@NgModule`,
  parameter decorators, etc.) anywhere in `src/`. This package is built with plain `tsc`
  (see `tsconfig.build.json`), not `ng-packagr`.

## Reporting issues

Open a GitHub issue with a minimal reproduction. If it's about a design decision
(e.g. cancellation semantics, error handling), feel free to open a discussion instead.

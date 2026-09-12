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
- `npm test`
- `npm run build`

Please make sure all four pass before opening a PR (CI runs the same checks).

## Guidelines

- Keep the primitive low-level and dependency-free, no RxJS, no HttpClient coupling.
- New behavior should come with a test in `src/mutation.spec.ts`.
- Match the existing code style.
- **No Angular decorators** (`@Injectable`, `@Directive`, `@Component`, `@Pipe`, `@NgModule`,
  parameter decorators, etc.) anywhere in `src/`. This package is built with plain `tsc`
  (see `tsconfig.build.json`), not `ng-packagr`.

## Reporting issues

Open a GitHub issue with a minimal reproduction. If it's about a design decision
(e.g. cancellation semantics, error handling), feel free to open a discussion instead.

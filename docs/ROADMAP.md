# Roadmap

`@ngsignal/mutation` is experimental (`0.x`). This page lists what is planned before `1.0`.
It is a direction, not a schedule: priorities can change with feedback.

## Before 1.0

- **Supply-chain security.** Keep hardening the build and release pipeline: pinned actions,
  least-privilege workflow tokens, npm trusted publishing with provenance, a protected release
  environment, and static analysis of the code (CodeQL) and of the workflows (zizmor).
- **Bug fixes.** Reported bugs come first, each with a regression test.
- **API design.** Refine the API and its semantics (concurrency, cancellation, errors) based on
  real-world use. Breaking changes are allowed in `0.x` minors and are always called out in the
  [CHANGELOG](../CHANGELOG.md).
- **TypeScript 7.** Move the build and the tests to TypeScript 7.
- **Community-driven features.** New features are driven by user feedback.
  [Open an issue](https://github.com/ngsignal/mutation/issues) or a
  [discussion](https://github.com/ngsignal/mutation/discussions) to propose one.

## Out of scope

`mutation()` stays a low-level primitive. A cache, query keys, automatic `resource()`
invalidation, retries and de-duplication are left to userland: see the
[recipes](./RECIPES.md), or reach for a full data-sync library such as TanStack Query
(compared in [ARCHITECTURE.md](./ARCHITECTURE.md)).

This list isn't final: if you think one of these belongs in the library,
[open a discussion](https://github.com/ngsignal/mutation/discussions).

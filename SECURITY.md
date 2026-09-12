# Security Policy

## Supported versions

`@ngsignal/mutation` is **experimental** (pre-1.0). Only the latest published version on
npm is supported. Security fixes are released as a new patch/minor version; there is no
backport policy for older `0.x` releases.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | ✅ |
| anything older | ❌ |

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, use GitHub's private reporting:

1. Go to the [Security tab](https://github.com/ngsignal/mutation/security) of this repository.
2. Click **"Report a vulnerability"** to open a private advisory.

If you're unable to use GitHub's private advisories, you can email
**erwan.raulo@outlook.fr** instead. Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal repro is very helpful).
- The affected version(s).

This is a solo-maintained project. I'll do my best to acknowledge reports within
**5 business days** and to ship a fix or mitigation within **30 days** for confirmed
issues, depending on severity and complexity.

## Scope

This package is a client-side Angular Signals primitive: it has no server component, no
network calls of its own (you provide `mutationFn`), and no runtime dependencies. In
practice, the realistic attack surface is limited to:

- The published npm package itself (tampering, supply-chain compromise of the release
  pipeline).
- The GitHub Actions workflows in [.github/workflows](.github/workflows) used to build,
  test, and publish releases.

Reports about the demo app in [ng-mutation-demo](https://github.com/ErwanRaulo/ng-mutation-demo)
should be filed against that repository instead.

## Supply-chain hardening already in place

- Releases are published via npm **trusted publishing** (OIDC, no long-lived npm token
  stored in CI), see [publish.yml](.github/workflows/publish.yml).
- Published packages carry npm **provenance attestations**, generated automatically by
  trusted publishing, so you can verify a release was built by this repository's CI from
  a specific commit/tag (`npm audit signatures`, or the "Provenance" badge on the
  [npm package page](https://www.npmjs.com/package/@ngsignal/mutation)).
- All GitHub Actions are pinned to a full commit SHA (not a mutable tag).
- Static analysis via [CodeQL](.github/workflows/codeql.yml) and
  [OpenSSF Scorecard](.github/workflows/scorecard.yml) run on every push to `main` and on
  a weekly schedule.
- Dependencies are kept up to date via [Dependabot](.github/dependabot.yml).

If you find a way to weaken any of the above (e.g. a workflow injection vector, a way to
publish without going through CI), that's very much in scope and appreciated.

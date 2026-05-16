# Dependency Maintenance

## Purpose

This repository has three npm package boundaries:

- `package.json` for the Next.js application and shared tooling
- `etl/package.json` for the Footywire ETL runtime
- `functions/package.json` for Firebase Functions

The long-term rule is simple: small same-major upgrades should be automated and reviewable, while framework, runtime, and major-version changes require a dedicated migration task.

## Weekly Flow

1. Dependabot opens grouped patch/minor PRs for each package boundary.
2. GitHub Actions runs the normal CI workflow plus the scheduled dependency report.
3. Reviewers compare the generated markdown report against the PR scope.
4. Major-version upgrades stay isolated and are converted into explicit implementation plans before merge.

## Safe Lane

Use the safe lane when all of the following are true:

- the candidate is a patch or minor release in the same major line
- the change does not modify the project Node runtime
- the package is not one of the framework or infra holdouts listed below
- the update reduces version skew already visible across root, `etl`, and `functions`

Examples:

- align `firebase-admin` across all manifests
- align `dotenv` across root and `etl`

## Review Lane

Always require a dedicated review and migration note for:

- `next`
- `react`
- `react-dom`
- `openai`
- `inngest`
- `firebase-functions`
- `typescript` when compiler diagnostics materially change
- `@types/node` when runtime targets differ between packages

## Verification Commands

Run the smallest relevant set after each dependency PR:

```bash
npm run deps:report
npm run typecheck
npm run lint
npm test
```

When the update touches ETL or Firebase Functions, also run:

```bash
(cd etl && npm run build)
(cd functions && npm run build)
```

If a package has no meaningful automated test command, call that out in the PR summary and rely on the nearest existing validation command instead of inventing one.

# Go-Live Design Drift Decision

Date: 2026-05-20

## Current Guard Result

- Command: `npm run guard:design`
- Result: pass
- Active findings: 0
- Hard-coded palette or hex candidates: 0
- Legacy icon import candidates: 0
- Allowlisted intentional findings: 8

The scanner still classifies product surfaces such as `admin`, `trade`, and `waiver`, but no launch-active findings remain in those surfaces. The remaining allowlisted findings are intentional legacy/demo entries and are not active guard failures.

## Closure Evidence

| Gate                         | Result | Evidence                                                           |
| ---------------------------- | ------ | ------------------------------------------------------------------ |
| Design-system guard          | pass   | `npm run guard:design` returned 0 active findings.                 |
| App typecheck                | pass   | `npm run typecheck:app` completed after the design migration.      |
| Test TypeScript project      | pass   | `npm run typecheck:tests` completed after the design migration.    |
| Lint                         | pass   | `npm run lint` completed after the design migration.               |
| Unit and integration suite   | pass   | `npm test` passed 147 files and 595 tests.                         |
| Whitespace and patch hygiene | pass   | `git diff --check` completed with no whitespace errors.            |
| Graph metadata               | pass   | `npm run graphify:update` reported no code-graph topology changes. |
| Branch completion gate       | pass   | `npm run branch:complete` completed after the design migration.    |

## Product Surface Decision

| Surface   | Active findings | Launch decision                                         |
| --------- | --------------- | ------------------------------------------------------- |
| auth      | 0               | closed as a design-system launch blocker                |
| dashboard | 0               | closed as a design-system launch blocker                |
| league    | 0               | closed as a design-system launch blocker                |
| draft     | 0               | closed as a design-system launch blocker                |
| trade     | 0               | closed as a design-system launch blocker                |
| waiver    | 0               | closed as a design-system launch blocker                |
| players   | 0               | closed as a design-system launch blocker                |
| admin     | 0               | closed as a design-system launch blocker                |
| shared UI | 0               | closed as a design-system launch blocker                |
| demo/debt | 8 allowlisted   | accepted as non-active legacy/demo debt pending cleanup |

## What Changed

The active design-drift closure migrated launch-scope UI away from hard-coded palette utilities, hex literals, and active legacy icon imports. The design-system path now uses semantic Tailwind tokens, CSS variables, shadcn-compatible button/input/table primitives where already established, and lucide icons for active icon imports.

The closure also added durable status and brand tokens in `src/index.css` so future code can express success, warning, information, destructive, and provider-brand roles without reintroducing arbitrary color literals.

## Decision

Statly no longer has a design-system go-live blocker from `npm run guard:design`.

No broad launch exception is required for active design drift. The remaining allowlisted intentional findings are accepted only as non-active demo/debt entries and must not be used as precedent for new product UI.

## Continuing Rule

New or changed launch-scope UI must keep `npm run guard:design` passing with zero active findings.

Any future exception must be narrow, reviewed, tied to non-launch-critical legacy/demo code, and must not cover a control that is inaccessible, unreadable, broken on mobile, missing focus visibility, or required to complete a launch-critical workflow.

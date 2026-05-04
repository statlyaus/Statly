# Design System Drift Baseline - 2026-05-04

## Target Stack

Statly standardizes on shadcn-style open components, Tailwind semantic tokens, and
lucide-react icons.

## Preserve

- Intentional public-page art direction.
- Team logo and club identity colors.
- Intentional dark sports surfaces.

## Replace

- Generic gray-card product shells.
- Repeated hard-coded palette ramps.
- Duplicated table, badge, panel, and form class strings.
- New Heroicons/React Icons usage in touched UI.

## Priority Surfaces

1. League workspace
2. Rankings and player tables
3. Roster and team management
4. Auth and app shell
5. Public marketing pages, review only

## Baseline Findings

The Phase 0 raw inventory command produced 4,187 current drift candidate lines in
`src/components` and `src/app`.

The Phase 6 reporting guard currently scans `src/components/**/*.{ts,tsx}` and
`src/app/**/*.{ts,tsx}`. Its broader token pattern counts each palette, gradient,
ring, and hex token separately. After narrowing the intentional exception
register to unreferenced demos, it reports 4,591 active findings and 142
allowlisted intentional findings after the roster, team management,
league/live-scoring, commissioner, draft hub, and app-shell auth migration:

- Hard-coded palette or hex candidates: 4,574
- Legacy icon import candidates: 17
- Allowlisted intentional findings: 142

Phase 0 raw inventory grouped by manual product surface:

| Surface                    | Candidate lines | Legacy icon lines | Notes                                                                        |
| -------------------------- | --------------: | ----------------: | ---------------------------------------------------------------------------- |
| Other components           |           1,812 |                23 | Broad shared-component backlog; migrate only when ownership is clear.        |
| Draft                      |             883 |                 0 | Includes draft room, history, settings, and draft public/workflow surfaces.  |
| Rankings and player tables |             693 |                13 | High-priority data surfaces with repeated table, card, and status styling.   |
| Roster and team management |             290 |                 7 | Includes roster rows, team panels, and player management controls.           |
| League workspace           |             162 |                 2 | Should converge on `leagueSurfacePatterns` and league semantic variables.    |
| Live scoring               |             155 |                 3 | Preserve intentional dark sports surfaces while replacing incidental ramps.  |
| Admin and commissioner     |              98 |                 1 | Operational surfaces should move toward quiet shadcn-style primitives.       |
| Public marketing pages     |              59 |                 2 | Review carefully; intentional art direction may be preserved or allowlisted. |
| Auth                       |              35 |                 1 | Replace generic gradients and Heroicons during auth surface migration.       |

Current guard active findings by scripted product surface:

| Scripted surface | Active findings |
| ---------------- | --------------: |
| `auth`           |              10 |
| `dashboard`      |             657 |
| `demo`           |               5 |
| `draft`          |           1,207 |
| `league`         |             261 |
| `live-scoring`   |              54 |
| `other`          |           1,432 |
| `players`        |             834 |
| `public`         |               2 |
| `roster`         |               0 |
| `shared-ui`      |              61 |
| `team`           |              68 |

## Guard Behavior

`npm run design:drift` is report mode. It prints grouped, capped findings and
exits 0 so migration workers can use it during the baseline period.

`npm run guard:design` is strict mode. It uses the same scan and exits non-zero
when active findings remain. Strict mode is intentionally not wired into
`prepush:ci` yet.

## Allowlist Policy

The guard has an explicit allowlist hook in `Scripts/design-drift-allowlist.ts`.
Allowlist entries must be narrow, tied to a documented design reason, and
reserved for intentional public art direction, club identity colors, demos, or
dark sports surfaces that should not be flattened into generic tokens.

Do not use the allowlist to hide broad legacy drift just to make strict mode
pass.

## Enforcement Budgets

Strict enforcement should be enabled in stages:

| Stage | Surfaces                             |                               Required active findings |
| ----- | ------------------------------------ | -----------------------------------------------------: |
| 1     | `auth`, `shared-ui`, `league`        |                                                      0 |
| 2     | `players`, `roster`, `team`          |                                                      0 |
| 3     | `draft`, `dashboard`, `live-scoring` |                 0 or documented dark-sports exceptions |
| 4     | `public`, `demo`, `other`            | reviewed and either migrated or intentionally excluded |

## Intentional Exception Register

| File pattern                                    | Category                | Reason                                                                         | Exit criteria                                                          |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/app/page.tsx`                              | palette                 | Public homepage uses intentional brand/art direction.                          | Revisit during marketing-page redesign; do not block product UI guard. |
| `src/app/fantasy/page.tsx`                      | palette                 | Public fantasy landing page uses intentional campaign art direction.           | Revisit during marketing-page redesign; do not block product UI guard. |
| `src/components/demos/AuthFormDemo.tsx`         | palette and legacy-icon | Unreferenced demo preserves historical auth form visual states.                | Delete or migrate when demo inventory is retired.                      |
| `src/components/demos/AuthHeaderDemo.tsx`       | palette and legacy-icon | Unreferenced demo preserves historical auth header visual states.              | Delete or migrate when demo inventory is retired.                      |
| `src/components/demos/AvailablePlayersDemo.tsx` | palette and legacy-icon | Unreferenced demo preserves historical available-player table examples.        | Delete or migrate when demo inventory is retired.                      |
| `src/components/demos/MatchLogTableDemo.tsx`    | palette and legacy-icon | Unreferenced demo preserves historical match-log table examples.               | Delete or migrate when demo inventory is retired.                      |
| `src/components/demos/MyTeamPanelDemo.tsx`      | palette and legacy-icon | Unreferenced demo preserves historical roster panel layout examples.           | Delete or migrate when demo inventory is retired.                      |
| `src/components/demos/MyTeamPanelDemo2.tsx`     | palette and legacy-icon | Unreferenced demo preserves historical alternate roster panel layout examples. | Delete or migrate when demo inventory is retired.                      |

## Demo Classification

| File                                            | Classification     | Reason                                                                                         | Next action                                         |
| ----------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `src/components/demos/AuthFormDemo.tsx`         | keep and allowlist | Unreferenced visual demo for historical auth form states.                                      | Delete or migrate during demo cleanup.              |
| `src/components/demos/AuthHeaderDemo.tsx`       | keep and allowlist | Unreferenced visual demo for historical auth header states.                                    | Delete or migrate during demo cleanup.              |
| `src/components/demos/AvailablePlayersDemo.tsx` | keep and allowlist | Unreferenced visual demo for historical available-player tables.                               | Delete or migrate during demo cleanup.              |
| `src/components/demos/MatchLogTableDemo.tsx`    | keep and allowlist | Unreferenced visual demo for historical match-log tables.                                      | Delete or migrate during demo cleanup.              |
| `src/components/demos/MyTeamPanelDemo.tsx`      | keep and allowlist | Unreferenced visual demo for historical team panel layouts.                                    | Delete or migrate during demo cleanup.              |
| `src/components/demos/MyTeamPanelDemo2.tsx`     | keep and allowlist | Unreferenced alternate visual demo for historical team panel layouts.                          | Delete or migrate during demo cleanup.              |
| `src/components/demos/SchedulingDemo.tsx`       | migrate            | Active route dependency through `src/app/scheduling/page.tsx`; should follow product UI rules. | Migrate in a focused large-file scheduling cleanup. |

## Enforcement Status

`npm run guard:design` is not ready to wire into `prepush:ci`. On 2026-05-05,
strict mode was run and failed with 4,591 active findings after intentional
exceptions were applied.

Do not enable strict enforcement until the remaining active product drift is
migrated or narrowly documented. Highest-signal remaining blockers are:

- active auth shared-component drift, including `src/components/AuthHeader.tsx`
  and `src/components/AuthForm.tsx`
- active route-mounted scheduling demo drift in
  `src/components/demos/SchedulingDemo.tsx`
- large draft room/dashboard/admin backlog still reported by the scripted surface
  summary

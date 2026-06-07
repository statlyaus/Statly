# Fantasy Website Consolidation Source Of Truth

Date: 2026-06-07

Council gate: `CHAIRMAN DECISION 1: PROCEED`

## Purpose

Statly has several markdown files that describe different versions of the fantasy AFL product. Some claim the system is complete, some describe later category replacements, and some document UI changes that were later reverted. This document is the current source of truth for the fantasy league, draft, category, player table, and admin settings work.

This spec supersedes the root-level completion summaries for planning and implementation decisions. The older markdown files remain useful as historical evidence, but they are not product authority unless this file references them directly.

## Canonical Branch

Use `/Users/robert/.config/superpowers/worktrees/Statly/fantasy-hardening-readiness` on branch `codex/fantasy-league-draft-hardening` as the implementation base.

Do not use local `/Users/robert/Developer/Statly` `main` for this consolidation work. That worktree is dirty and diverged from `origin/main`, and it has been the source of old/new runtime confusion.

## Historical Document Map

These files were audited and classified as follows:

| File                                                                           | Status                                | Use                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/superpowers/plans/2026-06-06-fantasy-league-draft-platform-hardening.md` | Current platform plan                 | Keep as the infrastructure hardening plan for auth, league ownership, draft lifecycle, rosters, waivers, and realtime boundaries.               |
| `NINE_CATEGORY_IMPLEMENTATION_SUCCESS.md`                                      | Current category evidence             | Use as the preferred category design because it maps to real AFL data coverage.                                                                 |
| `AFL_FANTASY_IMPLEMENTATION_COMPLETE.md`                                       | Historical and overstated             | Do not treat "complete and operational" claims as current. It conflicts with the real-data category replacement and visible runtime state.      |
| `IMPLEMENTATION_STATUS_RESOLVED.md`                                            | Historical category integration notes | Use only for locating older `NineCategoryDisplay`, `TopPicksModule`, and `usePlayerStats` work.                                                 |
| `AVAILABLE_PLAYERS_TABLE_OPTIMIZATION.md`                                      | Product intent                        | Use for player table expectations: search, filters, sorting, status, watchlist, queue, select, loading, empty states, and accessibility.        |
| `DRAFT_LOBBY_OPTIMIZATION_COMPLETE.md`                                         | Product intent                        | Use for queue, watchlist, readiness, lobby, tabs, and responsive draft preparation behavior.                                                    |
| `DRAFT_BANNER_OPTIMIZATION_COMPLETE.md`                                        | Product intent                        | Use for draft status, timer, current picker, turn state, and responsive status display.                                                         |
| `SNAKE_DRAFT_REVIEW.md` and `SNAKE_DRAFT_API.md`                               | Domain intent                         | Use for snake draft rules, turn validation, auto-pick, queue, and draft order behavior.                                                         |
| `LEAGUE_CUSTOM_FORMATS_IMPLEMENTATION.md`                                      | Admin/settings intent                 | Use for commissioner settings shape: basic, roster, draft, scoring, waivers, lockout.                                                           |
| `LEAGUE_DATA_ARCHITECTURE.md` and `LEAGUE_ISOLATED_DATA_FLOW_COMPLETE.md`      | Historical architecture intent        | Keep as Firestore-era reference. The current hardening plan makes Prisma canonical and Firestore a compatibility projection.                    |
| `UI_IMPROVEMENTS_SUMMARY.md` and `UI_REVERT_SUMMARY.md`                        | Historical contradiction              | Use as evidence that UI work was partially reverted. Do not revive the removed form/table abstractions without a current implementation reason. |

## Locked Category Preset

The fantasy product must use one named preset everywhere for category leagues, test leagues, draft player tables, rankings, admin settings, and seed data.

Preset name: `realDataNineCategory`

Category keys:

1. `goals`
2. `tackles`
3. `inside50s`
4. `intercepts`
5. `contestedMarks`
6. `rebound50s`
7. `contestedPossessions`
8. `effectiveDisposals`
9. `scoreInvolvements`

Rejected as the default category preset:

- The six-category create-league default: `kicks`, `handballs`, `marks`, `tackles`, `hitouts`, `goals`.
- The older nine-category list that depends on unavailable or replaced fields: `goalAssists`, `clearances`, and `onePercenters`.
- Any league or draft room state with `categoriesJson: null` for a category league.

The app can still support custom categories later, but the testable default fantasy experience must start with the locked preset above.

## Product Target

The working fantasy website must support this end-to-end flow:

1. Log in locally with the test user.
2. See a test league with one human team and enough bot teams for a full league.
3. Open league admin settings and see coherent basic, roster, draft, scoring, and waiver sections.
4. Confirm the scoring section is using `realDataNineCategory`.
5. Create or open a scheduled snake draft.
6. Enter the draft room and see available players with populated category stats.
7. Search, filter, sort, watchlist, queue, and select players.
8. See draft flow updates in the pick feed.
9. Complete or simulate enough picks to prove roster ownership and waiver availability consume the same source of truth.

## Component Targets

### Player Tables

Player tables must show the category preset directly, not generic "League categories not configured yet" for seeded/test category leagues.

Expected controls:

- Search by player, position, and club.
- Position filter.
- Sort by rank/value, category, name, position, and club where the screen supports it.
- Watchlist, queue, and select actions in the draft room.
- Loading, empty, and error states.
- Keyboard and screen-reader support for rows and actions.

### Draft Room

The draft room must use one coherent shell:

- Status banner for scheduled, lobby, countdown, live, paused, and complete states.
- Live pick header when active.
- Tabs for available players, queue, watchlist, and analytics.
- Pick feed visible on desktop and accessible on mobile.
- Queue and watchlist actions tied to authenticated league membership.
- No old/new visual split between semantic-token components and hard-coded legacy shells.

### Admin Settings

Commissioner/admin settings must expose:

- Basic league identity and privacy.
- Team count and membership.
- Roster limits by position, bench, and emergencies.
- Draft type, start time, pick timer, pick order, and auto-pick settings.
- Scoring preset and category list.
- Waiver system and processing rules.

Authorization must be enforced by server membership helpers, not only hidden buttons.

## Design Standard

Use existing shadcn-style open-code principles and semantic tokens:

- Prefer `bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, `bg-card`, and `text-card-foreground`.
- Avoid new hard-coded one-off color systems for feature screens.
- Preserve accessibility, focus states, labels, and keyboard behavior.
- Keep changes scoped and reviewable. Do not rebuild the whole app shell as a visual redesign.

The current latest branch still has mixed styles: `PlayerGrid` is closer to the target, while `UnifiedDraftRoom`, `DraftManager`, and `leagues/new` still contain older hard-coded gray/blue/custom-token styling.

## Data Ownership

Follow the hardening plan:

- Prisma is canonical for protected league membership, settings, drafts, picks, roster ownership, and waiver eligibility.
- Firestore is a compatibility projection for legacy realtime/client surfaces until those screens are migrated.
- API routes are transport adapters over shared server services.
- Auth and commissioner checks live at the data boundary.

## Done Criteria

This consolidation is done only when:

- The locked category preset is defined once and used by league creation, seeds, draft read models, and visible UI.
- The local test league has categories and bot teams without manual Firestore patching.
- The draft room player table shows real category stats.
- Admin settings reflect the same scoring/draft/roster/waiver configuration used by the APIs.
- The draft flow works in browser verification from login through draft room interactions.
- Relevant unit/type/lint checks pass or any residual failures are explicitly documented.
- Council Decision 2 approves the completed commit scope before commit.

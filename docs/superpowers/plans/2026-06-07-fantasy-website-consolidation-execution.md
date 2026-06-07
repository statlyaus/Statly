# Fantasy Website Consolidation Execution Plan

Date: 2026-06-07

Council gate: `CHAIRMAN DECISION 1: PROCEED`

Source of truth: `docs/superpowers/specs/2026-06-07-fantasy-website-consolidation.md`

Implementation base: `/Users/robert/.config/superpowers/worktrees/Statly/fantasy-hardening-readiness` on `codex/fantasy-league-draft-hardening`

## Objective

Turn the current hardening branch into one working fantasy website experience with the intended categories, player tables, draft room, admin settings, seeded local data, and coherent component styling.

## Rules

- Do not edit dirty local `main` for this work.
- Do not rely on stale root-level "complete" markdown claims.
- Do not introduce a new visual system.
- Do not stage `prisma/dev.db`, `.env`, `.next`, emulator data, or unrelated dirty files.
- Put substantive phase decisions to the LLM council, not the user.
- End each implementation phase with checks, browser verification when UI is involved, and Decision 2 before committing.

## Phase 1: Category Preset And Test League Data

Goal: eliminate the `categoriesJson: null` and six-category default drift.

- [x] Create one shared `realDataNineCategory` preset for the nine real-data category keys.
- [x] Update league creation normalization so category leagues default to the preset.
- [x] Include `scoringFormat` and categories in the new league submission path.
- [x] Update local seed/test-league scripts so the test league has categories and bot teams.
- [x] Add or update unit tests for league creation/category defaults and draft player selected categories.
- [x] Verify the draft player API returns `selectedCategories` with all nine keys for the seeded league.

Verification note: Phase 1 was verified against a migrated temporary copy of `prisma/dev.db` at `/tmp/statly-phase1-verify.db`, not the repo database. The initial copied DB was stale and missing newer migration columns such as `LeagueSettings.pickOrder`; `npx prisma migrate deploy` fixed the temp copy before route verification.

## Phase 2: Player Tables And Draft Table Stats

Goal: make the player table match the intended fantasy category experience.

- [x] Ensure draft available players expose per-game and total values for all nine preset categories.
- [x] Update `PlayerGrid` and stat display components to show the preset cleanly in table cells.
- [x] Replace "League categories not configured yet" with a real empty/configuration state only when the league is genuinely misconfigured.
- [x] Confirm search, position filter, sorting, watchlist, queue, and select actions still work.
- [x] Add focused tests for category rendering and accessibility.
- [x] Browser-verify the draft player table at desktop and mobile widths.

Verification note: Phase 2 was verified against a migrated temporary database at `/tmp/statly-phase2-verify.db`. The `/test-draft` helper created a 12-team draft through the browser on `http://localhost:3004`, and `/api/drafts/[id]/players` returned all nine category keys with player stat values. The protected draft room auth blocker noted at this checkpoint was later resolved by the local signed-in flow in Phase 5A and reverified in Phase 2B.

Phase 2B browser verification used fresh quick draft `cmq30s1tx0067ux9pyotww24w` on
`http://localhost:3004/drafts/cmq30s1tx0067ux9pyotww24w` with the local dev user. Desktop
verification proved search (`Nick Blakey`), position filter (`MID`), sort (`Sort by Name`),
watchlist, queue, manual start, and manual select all changed visible state. Caleb Daniel moved from
available players into the pick feed, the draft advanced to pick 2 of 2, and the table continued to
show all nine category stat columns. Mobile verification at 390px width proved the same table,
tabs, live header, and floating Pick Feed trigger rendered without a framework overlay.

## Phase 3: Commissioner Admin Settings

Goal: make admin settings coherent and connected to the same backend settings.

- [x] Identify the canonical admin/settings surface for league configuration.
- [x] Expose basic, roster, draft, scoring, and waiver sections in one commissioner flow.
- [x] Show the `realDataNineCategory` scoring preset and category list.
- [x] Persist changes through authenticated API routes with server-side manager checks.
- [x] Add tests for authorization and settings normalization.
- [x] Browser-verify that settings changes affect the draft/read model where expected.

Verification note: Phase 3A aligned league detail category defaults. Phase 3B added
`/api/leagues/[id]/settings` with member reads, manager writes, Prisma persistence, and Firestore
fallback normalization. Phase 3C replaced the static settings tab with an API-backed settings
panel for basic info, scoring, draft, roster, auto-pick, and waiver controls. The local
`test-league-id` settings fixture now renders without Firestore membership seeding, and the
settings tab browser check passed on `http://localhost:3004/leagues/test-league-id?tab=settings`.
This was an earlier checkpoint. Phase 3D below supersedes it with a full authenticated local proof
that persisted setting changes flow into the draft/read models.

Phase 3D fixed the Prisma-backed admin settings source-of-truth path used by local fantasy test
leagues. Shared league membership reads now recognize Prisma `LeagueMember` rows before Firestore
fallback, so the dev user `statly-dev-tester` can save settings on leagues created by
`/api/create-test-draft`. The broad league settings `PUT` now runs draft setup convergence after
persisting Prisma settings, and convergence updates an existing draft's `totalPicks` when roster
settings change without rebuilding a valid draft order. Live API verification on quick draft
`cmq30mj2l005uux9pgush011g` proved the admin settings save changed categories to
`goals/tackles/inside50s`, changed `timePerPick` to 60, and aligned both draft meta `totalPicks`
and `draftReadiness.totalPicks` to 4 after roster settings changed to two roster spots across two
teams.

## Phase 4: Draft Room Design Consolidation

Goal: remove the old/new visual split in the active fantasy workflow.

- [x] Convert `UnifiedDraftRoom` shell styling to semantic tokens and existing component patterns.
- [x] Convert `DraftManager` styling to the same standard.
- [x] Keep `PlayerGrid` table behavior intact while aligning radius, spacing, and color tokens.
- [x] Ensure mobile pick feed, desktop side panel, tabs, loading, error, and empty states remain accessible.
- [x] Run accessibility/unit tests that already cover draft components.
- [x] Browser-verify scheduled, live-ready, and empty states.

Verification note: Phase 4A converted the `UnifiedDraftRoom` loading/error/no-draft states, header
card, tabs, mobile pick-feed trigger/modal, and desktop pick-feed rail to semantic theme tokens.
`PlayerGrid` behavior was left unchanged. The new architecture test prevents the draft room shell
from reintroducing hard-coded legacy gray/blue/slate shell classes. This earlier browser access
blocker was superseded by the signed-in local flow restored in Phase 5A and verified again in Phase
4C.

Phase 4B converted `DraftManager` shell, prerequisite states, existing-draft card, create-draft
button, modal, draft-order controls, position limits, auto-pick, reminders, and modal actions to
semantic theme tokens without changing draft creation behavior. The new architecture test prevents
the commissioner draft panel from reintroducing hard-coded legacy color utilities. Full unit tests
including the existing draft room/player grid tests pass.

Phase 4C aligned `PlayerGrid` to the same token/radius standard without changing table behavior:
the table shell now uses compact `rounded-lg`, form controls use `rounded-md`, and injury badges no
longer use hard-coded orange/yellow palette utilities. The PlayerGrid accessibility test now also
guards against reintroducing oversized radii or legacy hard-coded palette classes. Browser
verification on quick draft `cmq30s1tx0067ux9pyotww24w` proved the scheduled room, live room,
desktop pick-feed side rail, mobile floating Pick Feed modal, tabs, category table, loading state,
and filtered empty state. The expected local Firebase-missing warnings remained limited to legacy
compatibility paths; no framework overlay was present. On reload, persisted pick backfill settled
the desktop side rail to Visible/All/Mine/Watchlist = 1 with Caleb Daniel after the polling window.

## Phase 5: End-To-End Local Fantasy Flow

Goal: prove the website is working, not just compiling.

- [x] Establish one local development identity for the canonical fantasy flow.
- [x] Align test draft seeding, league list reads, API auth, and server-rendered league page auth to the same local user.
- [x] Start Socket.IO and Next.js from the canonical worktree.
- [x] Create or reseed the local test user, league, bot teams, categories, and draft.
- [x] Verify local login with `admin@statly.dev` and the documented local development password.
- [x] Verify league list and league detail.
- [x] Verify admin settings.
- [x] Verify draft room available players, category stats, queue, watchlist, and pick feed.
- [x] Make at least one valid pick or simulated pick and verify roster/availability state.
- [x] Capture remaining defects in the source-of-truth spec or a follow-up plan if they cannot fit the phase.

Verification note: Phase 5A removed the local identity split that blocked browser verification. When
Firebase client auth is unavailable in non-production, `AuthContext` now supports the single local
test user `statly-dev-tester` via `admin@statly.dev` and the documented local development password,
persists it in local storage,
and writes a dev-only non-secret cookie so server-rendered league pages and API routes resolve the
same user. The league list now returns Prisma memberships before legacy Firestore memberships, and
`/api/create-test-draft` seeds the human team as `statly-dev-tester` with CPU teams and the locked
category preset. Firestore emulators are not required for this Prisma-backed fantasy verification
path; legacy Firestore fallback paths remain separate compatibility surfaces.

Browser verification on `http://localhost:3004` confirmed the canonical flow with seeded league
`cmq2ibx9w0002uxi9uos2wex6` and draft `cmq2ibx9x0004uxi9sdx8neiq`: login succeeded, the league
list showed the Prisma league with 12 teams and 9 categories, league detail loaded without the old
access-denied state, settings showed all nine scoring categories selected, the draft room connected
to Socket.IO without the connection-lost banner, queue/watchlist actions persisted for Caleb Daniel,
and a live pick removed Caleb from the available player pool while advancing the authoritative draft
state to pick 2. This also fixed the local socket split: both the draft page `SocketProvider` and the
lower-level Socket.IO client now default to the dedicated local socket server on
`http://localhost:3002`.

Follow-up browser verification with fresh scheduled draft `cmq2yfb5f0004ux9pi2hl1864` found the
visible `Start draft now` button was wired to the correct command but its hit target was covered by
the fixed desktop pick-feed rail at medium desktop widths. The scheduled/live header area now
reserves the same desktop rail space as the main player table. Browser hit-target verification then
resolved the button center to the actual button, and a visible click transitioned the draft to
`LIVE` through `/api/drafts/:id/start`.

Phase 5A identified post-draft roster projection and waiver availability as the next hardening
boundary.
Phase 5B below supersedes that warning with direct roster and waiver availability proof. Do not
treat the historical root-level "complete" summaries as evidence for these boundaries; use the
Phase 5B and final audit evidence instead.

Phase 5B added a development-only quick-completion fixture to `/api/create-test-draft` by passing
`{"mode":"quick-completion"}`. The standard call still creates the full 12-team, 22-round test
draft; quick-completion creates a two-team, one-round draft that uses the same dev user, CPU member
shape, and `realDataNineCategory` preset. Browser/API verification on quick draft
`cmq2yxu06001nux9poh90x8l8` proved the completion boundary: start succeeded, two authenticated
auto-picks completed the draft, `LeagueRosterPlayer` held the two drafted player ownership rows,
the roster API returned Caleb Daniel for `statly-dev-tester`, Firestore
`playerOwnerships/caleb_daniel` marked Caleb unavailable/owned, and Firestore
`availablePlayers/nick_blakey` marked an undrafted player available. The roster API now uses the
same `getAuthenticatedUserId` helper as the draft APIs so local `Authorization: Bearer dev:*` auth
works consistently across the completion flow.

Phase 5C browser/API verification found two manual-pick defects in the live draft flow. First, the
manual pick command used the lower-level request helper and rejected local bearer dev auth while
nearby draft and roster APIs accepted it. Second, a successful client pick command removed the
player from the table but did not apply the returned `currentPick` to the visible draft header, so
the room could show stale pick progress until refresh. The command route now uses the shared
`getAuthenticatedUserId` helper, and `DraftContext` applies command response state with the pick
delta. Regression coverage now proves bearer-aligned manual pick auth and visible current-pick
advancement after a successful pick response. Fresh API verification on quick draft
`cmq2zent2003cux9pbyfbdzh8` proved local dev bearer auth can make a manual
pick and returns `currentPick: 2`; browser refresh then showed pick 2 of 2, 641 available players,
and nine category stats for the remaining player table.

Phase 5D root-cause analysis found the open-room stale pick state was not a table rendering
problem. The Prisma-backed picks API already held the new pick, and refresh loaded it correctly, but
the client only listened for Socket.IO deltas after initial hydration. If local/dev socket delivery
or outbox flushing missed an event, the already-open room had no database-backed catch-up path and
the pick feed/player table stayed stale until manual refresh.

Phase 5D adds a persisted-picks fallback in `DraftContext`: while a draft is live, the room polls
`/api/drafts/:id/picks` from the latest known pick/snapshot timestamp, normalizes returned picks
through the same `PICK_MADE` reducer path used by socket/manual-pick updates, and refreshes the
draft snapshot when new persisted picks appear so header progress catches up too. It also preserves
known picks when a lean draft snapshot omits `picks`, and performs a no-cursor first-page pick load
when a live draft opens at `currentPick > 1` with an empty local pick list. That prevents a reload or
new browser session from showing an empty pick-feed rail after picks already exist.

Regression coverage proves both cases: an open room that misses the realtime delta now backfills the
pick, removes the player from availability, and advances visible `currentPick` without a manual
browser refresh; a live room opened after picks exist loads persisted picks without a `since` cursor
and keeps them through the lean snapshot refresh. Browser/API verification on quick draft
`cmq2zxb8z003vux9p3ai2djgj` then proved the real desktop flow: an external API pick changed the open
room from Pick 1 of 2 / 642 available players to Pick 2 of 2 / 641 available players without
refresh, and a wide desktop reload backfilled the pick-feed rail to All 1 / Mine 1 with Caleb Daniel
shown as the drafted player.

## Final Completion Audit

Audit date: 2026-06-07

- [x] Requirement: one locked `realDataNineCategory` preset is used by league creation, local test
  draft creation, league settings, league list/detail, draft creation, draft metadata, and draft
  player read models.
- [x] Requirement: local test data creates one human team, bot teams, categories, and a scheduled
  snake draft without manual Firestore patching.
- [x] Requirement: the draft room player table shows populated category stats and no false
  "League categories not configured yet" state for seeded category leagues.
- [x] Requirement: admin settings expose basic, roster, draft, scoring, auto-pick, and waiver
  configuration, persist through authenticated manager-checked API routes, and converge draft read
  models after relevant setting changes.
- [x] Requirement: rendered browser flow works from local login through scheduled draft room,
  search/filter/sort, watchlist, queue, manual start, manual select, pick-feed update, and mobile
  pick-feed access.
- [x] Requirement: enough completed picks prove roster ownership and waiver availability consume the
  same completed-draft projection.
- [x] Requirement: final verification checks pass or any residual advisory warnings are documented.

Fresh audit evidence:

- API completion proof on quick draft `cmq318kg2006yux9puhtck6ua` completed two picks, returned two
  persisted picks, and returned Caleb Daniel from
  `/api/leagues/cmq318kg0006wux9p7gbhwgcr/roster/statly-dev-tester`.
- Waiver proof on quick draft `cmq31962e007uux9p0jq6hl7s` rejected a waiver claim for drafted Caleb
  Daniel with HTTP 409 `Player already owned`, and accepted a claim for undrafted Aaron Cadman with
  HTTP 201.
- Browser proof on quick draft `cmq31a3rv008qux9pjzmd3gm7` used the local login
  `admin@statly.dev` with the documented local development password, opened the scheduled draft
  room, proved table controls, watchlist, queue, manual start, manual select, pick-feed counters,
  desktop rail, and mobile pick-feed modal state without a framework overlay or browser console
  errors.
- Verification commands:
  - `npm run typecheck` passed.
  - `npm run test:unit` passed: 64 files, 194 tests.
  - `npm run lint` exited 0 with existing advisory warnings.
  - `rm -rf .next && npm run build` passed. The first non-clean build failed from stale `.next`
    manifest state; a clean production build generated all routes successfully.

## Decision 2 Gate

Before each commit:

```bash
npm run typecheck
npm run test:unit
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed fantasy website consolidation phase should be committed."
```

Commit only if the council returns:

```text
CHAIRMAN DECISION 2: COMMIT
```

Use:

```bash
npm run codex:commit:reviewed -- "fantasy: <phase summary>"
```

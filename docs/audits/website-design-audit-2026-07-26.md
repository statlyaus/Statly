# Statly website design audit

- Date: 2026-07-26
- Branch: `codex/site-design-principles-audit`
- Scope: all 56 App Router page routes, including public, authentication, customer workspace, redirects, dynamic-detail states, demos, and internal diagnostics.

## Remediation status — 2026-07-27

The original findings below are preserved as the pre-remediation baseline. The audited
customer-facing site is now production-ready within the verified local scope: the P0 and P1
failures are no longer reproducible, and the shared P2 accessibility, reduced-motion, homepage,
and highest-reuse typography issues were corrected at their owning boundaries.

Resolved outcomes:

- Shared route-group shell ownership now prevents the narrow, off-canvas, and horizontally
  overflowing customer layouts recorded in the baseline.
- The Stats, Rosters, and round Match Centre runtime failures were repaired, audited navigation
  destinations resolve, Draft Room desktop overflow is contained, and league navigation is grouped
  without removing deep links.
- Button, Tooltip, Modal, and Badge accessibility contracts were repaired; global reduced-motion
  handling is active; client Sentry initializes at the client boundary.
- The homepage has a visible product promise, and recurring public Draft, ranking-chip, and compact
  stat microcopy now uses the 12px type floor and semantic theme tokens where applicable.

Completion evidence:

- `npm run test:unit -- --coverage.enabled=false`: 183 files and 719 tests passed.
- `npm run typecheck`, `npm run typecheck:tests`, and `npm run lint`: passed; lint retains the
  repository's pre-existing advisory warnings and reports zero errors.
- `npm run build`: passed on Next.js 15.4.10; all 81 static pages generated.
- Browser verification: 30 customer routes plus all 12 populated league task states passed direct
  load checks at 390px, 768px, and 1440px with no persistent blank state, horizontal overflow,
  runtime-error text, 404, or captured browser error.
- `prisma/dev.db` and `output/` remained protected and were excluded from every reviewed commit.

Residual, non-blocking risk:

- Integration tests were not pointed at the protected development database; they still require an
  isolated `DATABASE_URL_TEST` environment.
- Full `light | dark | system` preference wiring, remaining fixed-palette migration, and lower-use
  10–11px labels remain incremental design-system work; this report does not claim WCAG compliance.
- Live draft variants, role-specific league permissions, and external production services still
  require environment-specific acceptance testing before a deployment decision.

## Overall verdict

Statly has a promising newer visual language: a restrained primary navigation, authentic AFL imagery, clear action blue, semantic page headings, strong skip-link/form patterns, and several well-composed fantasy workflows. It is not ready for a broad visual polish pass yet. The highest-impact problem is structural: page-shell and width ownership varies by route, causing severe narrow-column, off-canvas, blank, and horizontal-overflow failures on both desktop and mobile. Three customer routes also hit runtime error boundaries.

Overall health: **critical remediation required before polish**.

## Audit evidence

- Route source of truth: 56 `page.tsx` files under `src/app`.
- Browser evidence: 61 distinct route/tab states captured at 1440×900 and 390×844 (122 accepted screenshots).
- Screenshot archive: `/Users/robert/.codex/visualizations/2026/07/26/019f9f1b-a0e6-7ce0-a679-10c9bf789a1e/site-design-audit/`.
- Captures were taken after DOM load and a 1.8-second visual-settle window. Blank or narrow captures were checked against populated DOM snapshots and are rendered-layout failures, not empty loading screenshots.
- Authenticated captures used the existing local development user. `prisma/dev.db` SHA-256 and timestamp were checked before and after; neither changed.
- Browser-only development controls (Next.js issue badge and floating development/social controls) are visible in some captures but excluded from product-layout scoring unless they obscure content.

## The ten-principle scorecard

| Principle                                   | Score | Evidence-based assessment                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Avoid clutter                            |   2/5 | The 3-item primary nav plus Tools disclosure is strong. Dense legacy pages, 12 league tabs, duplicated shells, and narrow columns make many screens feel harder than their content warrants.                                                                                                          |
| 2. Design above the fold                    |   2/5 | New draft/league setup pages establish context and next action well. The home hero lacks a visible value proposition, and broken/off-canvas pages lose essential context entirely.                                                                                                                    |
| 3. Use Hick's Law                           |   3/5 | Global navigation limits first-order choices well. League navigation exposes too many peer choices at once, Help presents many same-weight filters, and several internal/demo surfaces show uncurated control sets.                                                                                   |
| 4. Encourage scrolling, not excess clicking |   3/5 | The landing page and draft history tell a scrollable story. Tabs are appropriate in task workspaces when they reduce task time; the issue is excessive peer tabs and hidden content, not clicking itself.                                                                                             |
| 5. Keep photos authentic                    |   4/5 | Stadium, club-logo, player, and turf imagery is product-specific and credible. Do not add decorative stock photography to dense tools; fix hierarchy and whitespace first.                                                                                                                            |
| 6. Use visual cues                          |   3/5 | Icons usually accompany labels, active states are visible, and newer status treatments are clear. Dot-only status, color-dependent badges, missing disclosure state, and inconsistent empty/error presentation weaken the system.                                                                     |
| 7. Keep type legible                        |   2/5 | Inter and newer page headings are coherent. Thirty-seven TSX files use 10–11px text, and responsive collapse creates one-word-per-line copy on core pages.                                                                                                                                            |
| 8. Use color deliberately                   |   3/5 | Navy plus blue conveys trust/action and semantic status colors are generally understandable. Hard-coded league/draft/social palettes compete with shadcn tokens, and dark tokens exist while the root forces light mode.                                                                              |
| 9. Design mobile-first                      |   1/5 | Several newer forms reflow well, but public/auth, dashboard, league, rankings, analytics, commissioner, and detail routes fail at 390px. Confirmed widths reach 440px, 489px, 509px, 555px, and 687px on a 390px viewport.                                                                            |
| 10. Design for everyone                     |   2/5 | Skip links, semantic main regions, labels, focus styles, and form error associations are meaningful strengths. Runtime failures, off-canvas content, missing disclosure semantics, tiny text, incomplete focus management, and no reduced-motion override prevent any accessibility-compliance claim. |

## Highest-impact findings

### P0 — Fix before visual refinement

1. **Make the app shell the source of truth.** `src/app/(app)/layout.tsx` supplies providers but no shared page shell; pages must remember to render `AppLayout`. This drift is visible across auth, archive, dashboard, rankings, league, analytics, commissioner, and internal surfaces. Move the standard shell/container to the route-group layout and define explicit opt-outs for full-screen draft/broadcast pages.
2. **Stop width collapse and off-canvas rendering.** Confirmed on `/`, `/login`, `/register`, `/forgot-password`, `/privacy`, `/draft/trades`, `/draft/clubs`, `/dashboard`, `/rankings`, `/player-rankings`, `/team-analytics`, `/help`, `/commissioner`, and multiple league tabs. Test the actual owning wrapper, not one child card at a time.
3. **Repair three customer-facing crashes.** `/stats` throws `matches.forEach is not a function`; `/rosters` throws `useTeamContext must be used within a TeamProvider`; `/matches/1` rejects a server-to-client event handler prop.
4. **Restore meaningful league-tab rendering.** Overview, Teams, Matchups, Standings, Trades, and several mobile tab states render blank or as a few-pixel strip despite populated accessible DOM. Roster, Lineup, Draft, and Settings render more successfully, which provides a nearby working comparison.

### P1 — Correct navigation and mobile task flow

5. **Fix broken destinations.** Signed-out navigation links to missing `/fantasy`; Waivers links to missing `/waivers/submit`; Team Analytics points guests to missing `/auth/signin` instead of `/login`.
6. **Remove horizontal overflow and clipped controls.** Measured mobile document widths: Live Scoring 440px, Help 489px, Player Detail 509px, Commissioner 555px, and Team Analytics 687px. Draft Room also overflows desktop at 1504px on a 1440px viewport.
7. **Reduce league decision load.** Group the 12 peer tabs into task-oriented navigation (Play, League, Social, Settings), retain deep links, and use a compact mobile disclosure. Preserve direct access for common tasks rather than turning every section into a long scrolling page.
8. **Normalize page hierarchy.** Use one page title, one short purpose line, one primary action, and a consistent content container. Rankings, Match Centre, and several tab states currently duplicate or omit top-level headings.

### P2 — Consolidate the design and accessibility system

9. **Adopt semantic tokens end to end.** The shadcn token layer is strong, but 138 of 309 TSX files use fixed palette utilities while 97 use semantic tokens. Replace the second hard-coded league token object incrementally and wire the existing `light | dark | system` preference before claiming theme support.
10. **Set a type floor.** Raise recurring 10–11px captions/navigation labels to at least 12px with comfortable line height, then verify at 200% zoom.
11. **Repair shared primitives.** Modal focus trapping/restoration and reduced-motion values are computed but not applied; Tooltip's `aria-describedby` target lacks the matching id; link-style Button loading/disabled states remain tabbable; interactive Badge/StatusBadge states need focus and text equivalents.
12. **Clarify the home hero.** Keep the authentic stadium image and two clear CTAs, but add a concise visible product promise. The current H1 is screen-reader-only, so sighted users meet imagery and actions before understanding the offer.

## Page-by-page route audit

Health labels: **Good** = visually sound in the observed state; **Mixed** = usable with notable issues; **Poor** = major design/responsive failure; **Error** = runtime boundary; **Blocked** = the route exists but the required populated data was unavailable; **Internal** = not scored as a customer page.

|   # | Route                                 | Observed state              | Health and main finding                                                                                                                            |
| --: | ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `/`                                   | Public landing              | **Poor** — authentic hero and clear CTAs, but desktop crop overwhelms the message and mobile collapses into a narrow strip.                        |
|   2 | `/privacy`                            | Legal copy                  | **Poor** — desktop is readable; mobile collapses to one-word-per-line copy.                                                                        |
|   3 | `/terms`                              | Legal copy                  | **Good** — clear hierarchy and successful mobile reflow.                                                                                           |
|   4 | `/data-deletion`                      | Legal copy                  | **Good** — clear task explanation and successful mobile reflow; link discoverability is weak.                                                      |
|   5 | `/draft`                              | Redirect                    | **Good** — resolves to `/draft/trades`.                                                                                                            |
|   6 | `/draft/trades`                       | Empty explorer              | **Poor** — nested archive shell is off-canvas/narrow; no populated data for task assessment.                                                       |
|   7 | `/draft/trades/[tradeId]`             | 404 only                    | **Blocked** — no local archive fixture; invalid route correctly reaches 404, but populated detail is untested.                                     |
|   8 | `/draft/clubs`                        | Empty directory             | **Poor** — same shell collapse as trade explorer; empty state lacks useful next steps.                                                             |
|   9 | `/draft/clubs/[clubSlug]`             | 404 only                    | **Blocked** — no local archive fixture; populated club history is untested.                                                                        |
|  10 | `/login`                              | Sign-in form                | **Poor** — content collapses to a narrow left column at both viewports, compromising labels, controls, and third-party actions.                    |
|  11 | `/register`                           | Registration form           | **Poor** — desktop card is abnormally narrow and the mobile form renders off-canvas/blank.                                                         |
|  12 | `/forgot-password`                    | Recovery form               | **Poor** — form is positioned mostly outside the viewport at desktop and mobile widths.                                                            |
|  13 | `/tradecentre`                        | Legacy redirect             | **Good** — resolves to `/draft/trades`.                                                                                                            |
|  14 | `/dashboard`                          | Populated, 11 leagues       | **Poor** — useful command-center content exists in the DOM but renders as a narrow/off-canvas strip.                                               |
|  15 | `/players`                            | Populated, 642 players      | **Mixed** — strong search and summary model; mobile content is cramped and long despite no measured document overflow.                             |
|  16 | `/players/[id]`                       | Nick Daicos profile         | **Poor** — authentic club/player context and good decision framing; mobile overflows to 509px.                                                     |
|  17 | `/rankings`                           | Category rankings           | **Poor** — legend and table content collapse into an extremely narrow column.                                                                      |
|  18 | `/player-rankings`                    | Fallback table              | **Poor** — separate legacy implementation, narrow layout, and contradictory live/fallback messaging.                                               |
|  19 | `/stats`                              | Loaded route                | **Error** — `matches.forEach is not a function`.                                                                                                   |
|  20 | `/matches`                            | Empty live match centre     | **Poor** — two H1s, cramped desktop layout, and loading/empty messages compete above the fold.                                                     |
|  21 | `/matches/[round]`                    | Round 1                     | **Error** — server component passes an event handler to a client component.                                                                        |
|  22 | `/live-scoring`                       | Populated mock/live state   | **Mixed** — clear score hierarchy and status cues; mobile overflows to 440px.                                                                      |
|  23 | `/team-analytics`                     | Populated league selection  | **Poor** — desktop/mobile collapse and 687px mobile width hide most of the task surface.                                                           |
|  24 | `/rosters`                            | Authenticated route         | **Error** — missing `TeamProvider`.                                                                                                                |
|  25 | `/waivers`                            | Empty/free-agent state      | **Poor** — explanatory copy is useful, but the desktop/mobile content column becomes too narrow and dense.                                         |
|  26 | `/leaderboard`                        | Hard-coded standings        | **Mixed** — simple table is usable on mobile; direct-only/demo-like content lacks product context.                                                 |
|  27 | `/help`                               | Help index                  | **Poor** — strong categories and search, but narrow type, many equal-weight controls, and 489px mobile overflow.                                   |
|  28 | `/commissioner`                       | Populated admin form        | **Poor** — 31 inputs create heavy load; layout collapses and mobile reaches 555px.                                                                 |
|  29 | `/drafts`                             | Empty active-draft state    | **Good** — clear hierarchy, next action, and successful reflow.                                                                                    |
|  30 | `/drafts/create`                      | Setup form                  | **Good** — progressive hierarchy and mobile-friendly controls; verify validation/keyboard states separately.                                       |
|  31 | `/drafts/[id]`                        | Completed draft             | **Mixed** — strong status cues and authentic draft-room styling; desktop overflow and a 10,629px mobile page create excessive scan cost.           |
|  32 | `/drafts/history`                     | Six completed drafts        | **Good** — clear archive framing, search, and summary; long but intentional scrolling.                                                             |
|  33 | `/drafts/history/[id]`                | Completed detail            | **Good** — concise outcome summary and responsive cards/table hierarchy.                                                                           |
|  34 | `/drafts/settings`                    | Preferences                 | **Poor** — accessible labels exist, but layout collapses and settings become one-word-per-line.                                                    |
|  35 | `/leagues`                            | Redirect                    | **Good** — resolves to `/dashboard`.                                                                                                               |
|  36 | `/leagues/new`                        | Creation form               | **Good** — clear setup sequence and mobile reflow.                                                                                                 |
|  37 | `/leagues/join`                       | Invite form                 | **Good** — focused two-field task with clear supporting copy and mobile reflow.                                                                    |
|  38 | `/leagues/[id]`                       | Overview plus 10 tab states | **Poor** — 12 peer choices overload navigation; several tabs render blank/narrow while Roster, Lineup, Draft, and Settings are usable comparisons. |
|  39 | `/leagues/[id]/teams/[memberId]`      | Two-player roster           | **Poor** — populated roster DOM collapses into a narrow column.                                                                                    |
|  40 | `/leagues/[id]/social`                | Empty chat/community gate   | **Mixed** — desktop hierarchy and standards gate are clear; mobile renders largely off-canvas/blank.                                               |
|  41 | `/leagues/[id]/social/posts/[postId]` | Alias route                 | **Mixed** — code intends a redirect to Board thread state; direct browser URL did not visibly settle on the target path during the audit.          |
|  42 | `/leagues/[id]/trades`                | Alias route                 | **Mixed** — code intends a query-preserving redirect to the league Trades tab; direct browser URL did not visibly settle.                          |
|  43 | `/leagues/[id]/waivers`               | Alias route                 | **Mixed** — code intends a redirect to the league Waivers tab; direct browser URL did not visibly settle.                                          |
|  44 | `/demo`                               | Component demo              | **Internal** — useful catalogue; many equal-weight controls and demo-only emoji/color treatments should not set production precedent.              |
|  45 | `/player-analysis-demo`               | Live-data loading state     | **Internal** — coherent dark presentation and mobile reflow; permanent loading/zero-data state limits assessment.                                  |
|  46 | `/player-analysis`                    | Client redirect             | **Poor** — remained a blank loading surface instead of visibly resolving to `/players`.                                                            |
|  47 | `/live-stats`                         | No-data state               | **Internal** — missing shared shell and narrow desktop/mobile layout.                                                                              |
|  48 | `/scheduling`                         | Full builder                | **Internal** — useful controls, but desktop/mobile collapse makes the builder unusable.                                                            |
|  49 | `/infrastructure-test`                | Diagnostics                 | **Internal** — readable cards and reflow; should be access-controlled and excluded from customer navigation.                                       |
|  50 | `/sentry-test`                        | Diagnostics                 | **Internal** — narrow column and emoji-heavy controls; intentionally not a production design reference.                                            |
|  51 | `/test-draft`                         | Test creator                | **Internal** — severe narrow-column layout.                                                                                                        |
|  52 | `/test-live-data`                     | Integration test            | **Internal** — coherent responsive dark panel; test-only loading state.                                                                            |
|  53 | `/test-myteam`                        | Component test              | **Internal** — shared shell is present, but mobile heading/content clip horizontally.                                                              |
|  54 | `/test-search`                        | Search component test       | **Internal** — desktop centered correctly; mobile collapses into a narrow column.                                                                  |
|  55 | `/test-socket`                        | Connection test             | **Internal** — desktop captured blank while mobile showed a disconnected diagnostic state.                                                         |
|  56 | `/timer-test`                         | Timer test                  | **Internal** — desktop spacing is excessive; mobile controls collapse into a narrow stack.                                                         |

## Cross-cutting source evidence

- Shell fragmentation: `src/app/(app)/layout.tsx`, `src/components/navigation/AppLayout.tsx`, `src/app/(app)/stats/page.tsx`, and `src/app/(app)/live-stats/page.tsx`.
- Navigation strengths and debt: `src/components/navigation/MainNavigation.tsx` (primary IA, missing `/fantasy`, disclosure semantics, duplicated desktop/mobile trees).
- Theme/token fragmentation: `src/index.css`, `src/styles/leagueDesignSystem.ts`, and the unused persisted theme choice in `src/hooks/useDashboardSettings.ts`.
- Shared accessibility gaps: `src/components/ui/Modal.tsx`, `src/components/Button.tsx`, `src/components/ui/Tooltip.tsx`, `src/components/ui/Badge.tsx`, and missing global reduced-motion handling in `src/index.css`.
- Legibility risk: 37 TSX files use 10px/11px utilities, including navigation and player metadata.

## Verification gaps and residual risk

- Screenshots and DOM structure can identify visible accessibility risks, but they do not prove WCAG compliance. Keyboard order, focus trapping/restoration, screen-reader output, contrast ratios, 200%/400% zoom, and reduced-motion behavior still require dedicated testing.
- Public archive data was empty, so populated trade and club detail pages could not be audited. Their invalid-id 404 states were captured.
- The completed draft state was audited; live, paused, lobby, active-clock, and commissioner intervention states were not replayed.
- League pages used deterministic local test data. Role differences for non-commissioner members and unauthorized users need a separate state audit.
- No form was submitted and no destructive or production action was taken.

## Recommended implementation sequence

1. Fix shell/container ownership and add visual regression checks for public, auth, app, league, and full-screen route families at both baseline widths.
2. Fix the three runtime errors and the three broken navigation targets.
3. Repair mobile overflow and blank league-tab rendering; verify every customer route at 390px, 768px, and 1440px.
4. Simplify league navigation while preserving deep links and task speed.
5. Repair shared accessibility primitives, type floor, focus/keyboard behavior, and reduced-motion support.
6. Converge hard-coded palettes onto semantic tokens and wire the existing theme preference.
7. Finish with page-level hierarchy and polish, including the home hero's visible value proposition.

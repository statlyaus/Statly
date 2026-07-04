# Team Symbol Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let league members center/reposition their uploaded or linked team symbol thumbnail.

**Architecture:** Persist two normalized focus percentages (`teamLogoPositionX`, `teamLogoPositionY`) beside `teamLogoUrl` on league membership records. The Settings tab updates a live preview, saves the URL plus focus values through the existing member identity route, and the overview wall renders symbols with the saved `object-position`.

**Tech Stack:** Next.js App Router route handlers, Prisma, Firestore mirror helpers, React/TypeScript, Vitest, Testing Library.

---

### Task 1: Data Contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260703000000_add_team_logo_position_to_league_member/migration.sql`
- Modify: `src/types/leagues.ts`
- Modify: `src/lib/leagueMembership.ts`
- Modify: `src/lib/prismaLeagueBridge.ts`
- Modify: `src/server/leagues/leagueDetail.ts`
- Test: `tests/unit/leagueMembership.test.ts`

- [ ] Add optional `teamLogoPositionX` and `teamLogoPositionY` integer fields to `LeagueMember`.
- [ ] Add a migration that adds both columns without touching unrelated tables.
- [ ] Thread both fields through canonical Firestore data, Prisma mirrors, API detail output, and tests.

### Task 2: Validation And API

**Files:**
- Modify: `src/lib/teamSymbol.ts`
- Modify: `src/app/api/leagues/[id]/members/me/route.ts`
- Test: `tests/unit/teamSymbol.test.ts`
- Test: `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`

- [ ] Add `normalizeTeamSymbolPosition(value, fallback)` that returns an integer from 0 to 100.
- [ ] Save URL plus position values in both Prisma and Firestore paths.
- [ ] Return position values in the route response.
- [ ] Cover valid values, string numbers, missing fallbacks, and invalid clamping/rejection behavior.

### Task 3: Settings UI And Overview Rendering

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Test: `tests/unit/LeagueTabs.teamIdentity.test.tsx`
- Test: `tests/unit/LeagueTabs.overview.test.tsx`
- Test: `tests/unit/leagueSettingsUiArchitecture.test.ts`

- [ ] Add horizontal and vertical focus slider state to the Team identity section.
- [ ] Apply focus to the live preview and overview wall via `objectPosition`.
- [ ] Save focus values with pasted URLs, uploaded images, and clear actions.
- [ ] Use focus values when cropping uploaded images to a square data URL.
- [ ] Verify the settings controls are accessible and the overview image uses the saved position.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run focused unit tests for team symbol validation, membership data, member identity route architecture, settings identity UI, overview UI, and settings architecture.
- [ ] Run ESLint on touched TS/TSX files.
- [ ] Run `npm run typecheck`.
- [ ] Browser-smoke the Settings tab and overview wall on `http://localhost:3000/leagues/cmezlicop0002uxzjdtavv4mk`.

# Team Symbol Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted zoom control so team symbol images can be scaled before horizontal and vertical centering.

**Architecture:** Store `teamLogoZoom` beside the existing team symbol URL and X/Y position fields. Normalize zoom at API and UI boundaries, render settings preview and league overview symbols with the same transform, and resize uploaded images using the selected zoom/focus.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Vitest, Playwright smoke checks.

---

### Task 1: Persist Team Symbol Zoom

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260703010000_add_team_logo_zoom_to_league_member/migration.sql`
- Modify: `src/types/leagues.ts`
- Modify: `src/lib/leagueMembership.ts`
- Modify: `src/lib/prismaLeagueBridge.ts`
- Modify: `src/server/leagues/leagueDetail.ts`
- Modify: `src/app/api/leagues/[id]/members/me/route.ts`

- [ ] **Step 1: Add the database column**

Add `teamLogoZoom Float?` to `LeagueMember` next to `teamLogoPositionY`.

- [ ] **Step 2: Add migration SQL**

Create a migration adding nullable `teamLogoZoom`.

- [ ] **Step 3: Thread the field through API and server member shapes**

Add optional `teamLogoZoom?: number` to league member TypeScript shapes and include it in Prisma selects, response mappers, bridge writes, and Firestore fallback patches.

### Task 2: Normalize And Render Zoom

**Files:**
- Modify: `src/lib/teamSymbol.ts`
- Modify: `src/components/league/LeagueTabs.tsx`

- [ ] **Step 1: Add zoom constants and normalizer**

Use default zoom `1`, min zoom `1`, max zoom `3`, step precision `0.05`.

- [ ] **Step 2: Add UI helper**

Add a local helper in `LeagueTabs.tsx` mirroring server normalization for display state.

- [ ] **Step 3: Render preview and overview with zoom**

Apply `transform: scale(zoom)` and `transformOrigin` from X/Y position so horizontal movement has visible crop room once zoom is above `1x`.

### Task 3: Add Settings Control And Upload Crop Support

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`

- [ ] **Step 1: Add `teamSymbolZoom` state**

Initialize from `currentMember?.teamLogoZoom`, sync in the existing effect, and include in save payload.

- [ ] **Step 2: Add a Zoom slider**

Render it before horizontal/vertical centre with accessible label `Zoom` and visible scale endpoints.

- [ ] **Step 3: Use zoom when resizing uploads**

Update canvas crop math to account for the selected zoom and X/Y focus before creating the square data URL.

### Task 4: Tests And Verification

**Files:**
- Modify: existing focused unit tests under `tests/unit`

- [ ] **Step 1: Update unit tests**

Cover zoom normalization, API request body/response shape, settings UI copy, and overview/settings rendered style.

- [ ] **Step 2: Run focused checks**

Run focused Vitest files, typecheck, ESLint, and diff whitespace checks.

- [ ] **Step 3: Browser smoke**

Use Playwright on the settings screen with a wide image URL, set zoom above `1x`, move horizontal/vertical controls, and verify rendered styles update without failed requests.

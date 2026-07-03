# Team Symbols League Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the league overview team table with a visual 12-team symbol wall, and let each team set its symbol from a pasted image URL or a validated uploaded image.

**Architecture:** Store the team symbol on the league member record as `teamLogoUrl`, because the symbol belongs to a team membership, not the league settings object. The overview reads the same `LeagueMember[]` it already receives, and settings gets a member-owned "Team identity" form that PATCHes the current member through a dedicated member API route. Prisma remains the primary data source when a Prisma league exists; Firestore membership documents remain the fallback and mirror path.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Prisma SQLite, Firebase Admin Firestore fallback, Vitest, React Testing Library, Playwright browser verification, existing Statly council/commit scripts.

---

## File Structure

- Modify `prisma/schema.prisma`
  - Add nullable `teamLogoUrl String?` to `LeagueMember`.
  - No new table is needed.

- Modify `src/types/leagues.ts`
  - Add optional `teamLogoUrl?: string` to `LeagueMemberDoc`, `LeagueMember`, and membership-related write shapes where needed.

- Modify `src/lib/leagueMembership.ts`
  - Add `teamLogoUrl?: string` to `LeagueMembershipWrite` and `LeagueMembershipListItem`.
  - Persist `teamLogoUrl` through canonical set/patch helpers.
  - Return `teamLogoUrl` from active member list helpers.

- Modify `src/lib/prismaLeagueBridge.ts`
  - Add `teamLogoUrl` to mirror member types and Firestore-to-Prisma conversion.
  - Persist `teamLogoUrl` when syncing/mirroring members.

- Modify `src/server/leagues/leagueDetail.ts`
  - Select/map `teamLogoUrl` from Prisma league members.
  - Map Firestore `teamLogoUrl` through `toApiLeagueMember`.
  - Add demo/test fixture symbols so the overview wall is visibly populated in local/dev screenshots.

- Create `src/lib/teamSymbol.ts`
  - Centralize validation and normalization for image URLs and uploaded data URLs.
  - Keep the contract framework-agnostic so route tests can exercise it without rendering React.

- Create `src/app/api/leagues/[id]/members/me/route.ts`
  - `PATCH` current member identity.
  - Authenticates with `getAuthenticatedUserId`.
  - Authorizes with `getLeagueMembership`.
  - Accepts `{ teamLogoUrl: string | null }`.
  - Updates Prisma league member when Prisma owns the league.
  - Falls back to Firestore membership patch when no Prisma league exists.

- Modify `src/components/league/LeagueTabs.tsx`
  - Replace overview team table with a 12-slot symbol wall.
  - Add a reusable local rendering helper for symbol fallback initials.
  - Add a member-owned settings section outside the commissioner-only fieldset.
  - Add client-side file upload handling that resizes PNG/JPEG/WebP to a compact data URL.
  - Add pasted URL handling that sends the member API request.

- Modify `tests/unit/LeagueTabs.overview.test.tsx`
  - Assert the overview renders a team symbol wall instead of table headers.
  - Assert image-backed teams render `<img>` with accessible team name.
  - Assert teams without symbols render initials.

- Create `tests/unit/LeagueTabs.teamIdentity.test.tsx`
  - Assert the settings tab shows "Team identity" to a normal member.
  - Assert pasted image URL save calls the member API route with `PATCH`.
  - Assert uploaded file validation rejects non-image or oversized files without a network call.

- Modify `tests/unit/leagueMembership.test.ts`
  - Assert canonical membership set/patch helpers include `teamLogoUrl`.
  - Assert active member list mapping preserves `teamLogoUrl`.

- Create `tests/unit/teamSymbol.test.ts`
  - Validate accepted `https://`, `http://`, and allowed `data:image/png|jpeg|webp` values.
  - Reject javascript URLs, empty strings, unsupported data MIME types, and too-large data URLs.

- Create `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`
  - Source-level architecture test for auth, membership authorization, Prisma primary update, and Firestore fallback patch.

## Scope Notes

- This plan deliberately does not add Firebase Storage or a new object-storage dependency. The first implementation supports upload by converting a selected local image to a resized data URL and storing it in `teamLogoUrl`.
- Uploaded image support is intentionally limited to PNG, JPEG, and WebP. SVG uploads are rejected because SVG can carry script-like payloads when served from untrusted origins.
- External URL support allows only `http:` and `https:` URLs. Rendering uses a plain `<img>` tag because Next Image remote domains are not configured for arbitrary team URLs.
- Each team edits only its own symbol. Commissioner controls remain for league settings; this avoids turning the existing admin-only settings form into a mixed-permission form.

---

### Task 1: Member Symbol Data Contract

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/types/leagues.ts`
- Modify: `src/lib/leagueMembership.ts`
- Modify: `src/lib/prismaLeagueBridge.ts`
- Modify: `src/server/leagues/leagueDetail.ts`
- Test: `tests/unit/leagueMembership.test.ts`

- [ ] **Step 1: Write the failing membership helper tests**

Add these assertions to `tests/unit/leagueMembership.test.ts` inside the existing `describe('leagueMembership architecture helpers', () => { ... })` block.

```ts
  it('persists team symbols in canonical membership documents', () => {
    const data = toCanonicalLeagueMembershipData({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'member',
      teamName: 'Symbol Team',
      teamLogoUrl: 'https://cdn.example.com/symbol-team.png',
      joinedAt: '2026-07-03T00:00:00.000Z',
    });

    expect(data).toMatchObject({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'member',
      teamName: 'Symbol Team',
      teamLogoUrl: 'https://cdn.example.com/symbol-team.png',
      isActive: true,
      status: 'ACTIVE',
    });
  });

  it('patches team symbols without changing unrelated membership fields', () => {
    const patch = toCanonicalLeagueMembershipPatch({
      teamLogoUrl: 'data:image/png;base64,abc123',
    });

    expect(patch).toEqual({
      teamLogoUrl: 'data:image/png;base64,abc123',
    });
  });
```

Also update the existing canonical member document test in the same file so its expected object includes:

```ts
      teamLogoUrl: undefined,
```

Expected failure before implementation: TypeScript reports that `teamLogoUrl` is not assignable to `LeagueMembershipWrite`, or the assertions receive no `teamLogoUrl`.

- [ ] **Step 2: Run the failing focused test**

Run:

```bash
npm run test:unit -- tests/unit/leagueMembership.test.ts
```

Expected: FAIL because `teamLogoUrl` is not part of the membership write/patch contract yet.

- [ ] **Step 3: Add `teamLogoUrl` to the Prisma model**

In `prisma/schema.prisma`, update the `LeagueMember` model:

```prisma
model LeagueMember {
  id            String               @id @default(cuid())
  leagueId      String
  userId        String
  role          LeagueRole
  teamName      String
  teamLogoUrl   String?
  draftSlot     Int?
  joinedAt      DateTime             @default(now())
  league        League               @relation(fields: [leagueId], references: [id])
  user          User                 @relation(fields: [userId], references: [id])
  picks         Pick[]
  orders        DraftOrder[]
  rosterPlayers LeagueRosterPlayer[]

  // Lobby relations
  watchlists      DraftWatchlist[]
  preDraftQueues  PreDraftQueue[]
  lobbyActivities LobbyActivity[]

  @@index([leagueId])
  @@index([userId])
  @@index([leagueId, userId])
  @@index([draftSlot])
}
```

Run:

```bash
npx prisma migrate dev --name add_team_logo_url_to_league_member
```

Expected: Prisma creates a migration adding nullable `teamLogoUrl` to `LeagueMember` and regenerates the client.

- [ ] **Step 4: Add `teamLogoUrl` to league member TypeScript types**

In `src/types/leagues.ts`, update the member interfaces:

```ts
export interface LeagueMemberDoc {
  id: string;
  leagueId: string;
  userId: string;
  role: MemberRole;
  teamName: string;
  teamLogoUrl?: string;
  joinedAt: Timestamp;
  leftAt?: Timestamp;
  isActive?: boolean;
}

export interface LeagueMember {
  id: string;
  leagueId: string;
  userId: string;
  role: MemberRole;
  teamName: string;
  teamLogoUrl?: string;
  joinedAt: string;
  leftAt?: string;
  isActive?: boolean;
}
```

- [ ] **Step 5: Preserve `teamLogoUrl` in membership helpers**

In `src/lib/leagueMembership.ts`, update the interfaces:

```ts
export interface LeagueMembershipWrite {
  leagueId: string;
  userId: string;
  role?: string;
  teamName?: string;
  teamLogoUrl?: string | null;
  joinedAt?: unknown;
  leftAt?: unknown;
  isActive?: boolean;
  status?: string;
  draftPreferences?: unknown;
  scoringPreferences?: unknown;
  notificationSettings?: unknown;
  migratedFrom?: string;
  migratedAt?: unknown;
}

export interface LeagueMembershipListItem {
  id: string;
  leagueId: string;
  userId: string;
  role: string;
  teamName: string;
  teamLogoUrl?: string;
  joinedAt?: unknown;
  leftAt?: unknown;
  isActive: boolean;
  source: Exclude<MembershipSource, 'none'>;
}
```

In `toCanonicalLeagueMembershipData`, add the property after `teamName`:

```ts
    teamLogoUrl: membership.teamLogoUrl ?? undefined,
```

In `toCanonicalLeagueMembershipPatch`, add:

```ts
  if (updates.teamLogoUrl !== undefined) patch.teamLogoUrl = updates.teamLogoUrl ?? undefined;
```

In the local helper that converts Firestore documents to active member list items, include:

```ts
      teamLogoUrl: typeof data.teamLogoUrl === 'string' ? data.teamLogoUrl : undefined,
```

Use the exact local variable name already present in `toActiveMemberList`; if the helper calls the document data `raw` instead of `data`, use `raw.teamLogoUrl`.

- [ ] **Step 6: Preserve `teamLogoUrl` in Prisma mirror helpers**

In `src/lib/prismaLeagueBridge.ts`, update `PrismaLeagueMirrorMember` and `SyncPrismaLeagueMemberInput`:

```ts
export interface PrismaLeagueMirrorMember {
  id: string;
  leagueId: string;
  userId: string;
  role: string;
  teamName: string;
  teamLogoUrl?: string;
  draftSlot?: number;
  isActive: boolean;
}

export interface SyncPrismaLeagueMemberInput {
  leagueId: string;
  userId: string;
  memberId?: string;
  role?: string;
  teamName?: string;
  teamLogoUrl?: string | null;
  draftSlot?: number;
  isActive?: boolean;
  timeZone?: string;
}
```

Where `toMirrorMember` returns a member object, add:

```ts
    teamLogoUrl: stringOrUndefined(data.teamLogoUrl),
```

Where Prisma league members are created or upserted, include the field beside `teamName`:

```ts
        teamName: input.teamName,
        teamLogoUrl: input.teamLogoUrl ?? undefined,
```

Where members are mapped back to display/participant objects, preserve:

```ts
    teamLogoUrl: member.teamLogoUrl ?? undefined,
```

- [ ] **Step 7: Return `teamLogoUrl` from league detail loaders**

In `src/server/leagues/leagueDetail.ts`, update the Prisma member mapping:

```ts
      const members = prismaLeague.members.map((member) => ({
        id: member.id,
        leagueId: member.leagueId,
        userId: member.userId,
        teamName: member.teamName,
        teamLogoUrl: member.teamLogoUrl ?? undefined,
        joinedAt: member.joinedAt.toISOString(),
        isActive: true,
        role: member.userId === prismaLeague.ownerId ? 'owner' : 'member',
      })) satisfies LeagueMember[];
```

Update at least four `createTestMembers()` entries so local visual QA has real symbols:

```ts
      teamLogoUrl: 'https://placehold.co/160x160/0f2f47/ffffff.png?text=RR',
```

Use distinct initials in the query string for each fixture team, for example `RR`, `AL`, `FF`, and `GG`.

Update `toApiLeagueMember`:

```ts
    teamLogoUrl: member.teamLogoUrl,
```

- [ ] **Step 8: Run the focused data-contract checks**

Run:

```bash
npm run test:unit -- tests/unit/leagueMembership.test.ts
npm run typecheck
```

Expected: both PASS. If Prisma generated files changed, keep them only if the repo normally commits generated Prisma client output; otherwise commit only schema and migration files.

- [ ] **Step 9: Commit the data contract**

Run:

```bash
git status --short
git add prisma/schema.prisma prisma/migrations src/types/leagues.ts src/lib/leagueMembership.ts src/lib/prismaLeagueBridge.ts src/server/leagues/leagueDetail.ts tests/unit/leagueMembership.test.ts
git commit -m "Add team symbol field to league members"
```

Expected: commit includes only the data contract, migration, loader mappings, and tests. Do not stage `prisma/dev.db`.

---

### Task 2: Team Symbol Validation Helpers

**Files:**
- Create: `src/lib/teamSymbol.ts`
- Create: `tests/unit/teamSymbol.test.ts`

- [ ] **Step 1: Write the failing validation tests**

Create `tests/unit/teamSymbol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  MAX_TEAM_SYMBOL_DATA_URL_LENGTH,
  normalizeTeamSymbolUrl,
} from '@/lib/teamSymbol';

describe('team symbol validation', () => {
  it('accepts http and https image URLs', () => {
    expect(normalizeTeamSymbolUrl(' https://cdn.example.com/team.png ')).toBe(
      'https://cdn.example.com/team.png'
    );
    expect(normalizeTeamSymbolUrl('http://example.com/logo.webp')).toBe(
      'http://example.com/logo.webp'
    );
  });

  it('accepts small png jpeg and webp data URLs', () => {
    expect(normalizeTeamSymbolUrl('data:image/png;base64,abc123')).toBe(
      'data:image/png;base64,abc123'
    );
    expect(normalizeTeamSymbolUrl('data:image/jpeg;base64,abc123')).toBe(
      'data:image/jpeg;base64,abc123'
    );
    expect(normalizeTeamSymbolUrl('data:image/webp;base64,abc123')).toBe(
      'data:image/webp;base64,abc123'
    );
  });

  it('turns blank and null values into null so the symbol can be cleared', () => {
    expect(normalizeTeamSymbolUrl('')).toBeNull();
    expect(normalizeTeamSymbolUrl('   ')).toBeNull();
    expect(normalizeTeamSymbolUrl(null)).toBeNull();
  });

  it('rejects unsafe or unsupported values', () => {
    expect(() => normalizeTeamSymbolUrl('javascript:alert(1)')).toThrow(
      'Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL'
    );
    expect(() => normalizeTeamSymbolUrl('ftp://example.com/logo.png')).toThrow(
      'Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL'
    );
    expect(() => normalizeTeamSymbolUrl('data:image/svg+xml;base64,abc123')).toThrow(
      'Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL'
    );
  });

  it('rejects oversized data URLs', () => {
    const oversized = `data:image/png;base64,${'a'.repeat(MAX_TEAM_SYMBOL_DATA_URL_LENGTH)}`;

    expect(() => normalizeTeamSymbolUrl(oversized)).toThrow(
      'Uploaded team symbol is too large'
    );
  });
});
```

- [ ] **Step 2: Run the failing validation tests**

Run:

```bash
npm run test:unit -- tests/unit/teamSymbol.test.ts
```

Expected: FAIL because `src/lib/teamSymbol.ts` does not exist.

- [ ] **Step 3: Implement validation helper**

Create `src/lib/teamSymbol.ts`:

```ts
const ALLOWED_DATA_URL_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/webp;base64,',
] as const;

export const MAX_TEAM_SYMBOL_DATA_URL_LENGTH = 120_000;

export function normalizeTeamSymbolUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error('Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL');
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    const hasAllowedPrefix = ALLOWED_DATA_URL_PREFIXES.some((prefix) =>
      trimmed.startsWith(prefix)
    );
    if (!hasAllowedPrefix) {
      throw new Error('Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL');
    }
    if (trimmed.length > MAX_TEAM_SYMBOL_DATA_URL_LENGTH) {
      throw new Error('Uploaded team symbol is too large');
    }
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL');
  }

  return parsed.toString();
}
```

- [ ] **Step 4: Run validation checks**

Run:

```bash
npm run test:unit -- tests/unit/teamSymbol.test.ts
npx eslint src/lib/teamSymbol.ts tests/unit/teamSymbol.test.ts
```

Expected: both PASS.

- [ ] **Step 5: Commit validation helper**

Run:

```bash
git add src/lib/teamSymbol.ts tests/unit/teamSymbol.test.ts
git commit -m "Add team symbol validation"
```

---

### Task 3: Current Member Team Identity API

**Files:**
- Create: `src/app/api/leagues/[id]/members/me/route.ts`
- Create: `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`
- Modify: `tests/unit/leagueMembership.test.ts`

- [ ] **Step 1: Write the route architecture test**

Create `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league member identity route architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/app/api/leagues/[id]/members/me/route.ts'), 'utf8');

  it('authenticates and authorizes membership before writes', () => {
    const route = source();

    expect(route).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(route).toContain("import { getLeagueMembership, queueLeagueMembershipPatch } from '@/lib/leagueMembership'");
    expect(route).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(route).toContain('const membership = await getLeagueMembership(id, userId);');
    expect(route).toContain('if (!membership.isMember)');
    expect(route.indexOf('const membership = await getLeagueMembership(id, userId);')).toBeLessThan(
      route.indexOf('const body = (await request.json()) as Record<string, unknown>;')
    );
  });

  it('normalizes team symbol input through the shared validation helper', () => {
    const route = source();

    expect(route).toContain("import { normalizeTeamSymbolUrl } from '@/lib/teamSymbol'");
    expect(route).toContain('const teamLogoUrl = normalizeTeamSymbolUrl(body.teamLogoUrl);');
    expect(route).toContain("return NextResponse.json({ error: error.message }, { status: 400 });");
  });

  it('updates Prisma first and Firestore fallback with the same field', () => {
    const route = source();

    expect(route).toContain('await prisma.leagueMember.update({');
    expect(route).toContain('where: { id: membership.memberDocId }');
    expect(route).toContain('data: { teamLogoUrl }');
    expect(route).toContain('queueLeagueMembershipPatch(batch, id, userId, { teamLogoUrl });');
    expect(route).toContain('await batch.commit();');
  });
});
```

Expected failure before implementation: file does not exist.

- [ ] **Step 2: Run the failing architecture test**

Run:

```bash
npm run test:unit -- tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
```

Expected: FAIL because the route file is missing.

- [ ] **Step 3: Implement the current member identity route**

Create `src/app/api/leagues/[id]/members/me/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueMembership, queueLeagueMembershipPatch } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { normalizeTeamSymbolUrl } from '@/lib/teamSymbol';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await getLeagueMembership(id, userId);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    let teamLogoUrl: string | null;
    try {
      teamLogoUrl = normalizeTeamSymbolUrl(body.teamLogoUrl);
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid team symbol' }, { status: 400 });
    }

    if (membership.source === 'prisma' && membership.memberDocId) {
      const updatedMember = await prisma.leagueMember.update({
        where: { id: membership.memberDocId },
        data: { teamLogoUrl },
        select: {
          id: true,
          leagueId: true,
          userId: true,
          role: true,
          teamName: true,
          teamLogoUrl: true,
          joinedAt: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          member: {
            id: updatedMember.id,
            leagueId: updatedMember.leagueId,
            userId: updatedMember.userId,
            role: String(updatedMember.role).toLowerCase(),
            teamName: updatedMember.teamName,
            teamLogoUrl: updatedMember.teamLogoUrl ?? undefined,
            joinedAt: updatedMember.joinedAt.toISOString(),
            isActive: true,
          },
        },
      });
    }

    const batch = adminDb.batch();
    queueLeagueMembershipPatch(batch, id, userId, { teamLogoUrl });
    await batch.commit();

    return NextResponse.json({
      success: true,
      data: {
        member: {
          id: membership.memberDocId ?? userId,
          leagueId: id,
          userId,
          role: typeof membership.data?.role === 'string' ? membership.data.role : 'member',
          teamName:
            typeof membership.data?.teamName === 'string' ? membership.data.teamName : 'Team',
          teamLogoUrl: teamLogoUrl ?? undefined,
          joinedAt:
            typeof membership.data?.joinedAt === 'string'
              ? membership.data.joinedAt
              : new Date().toISOString(),
          isActive: true,
        },
      },
    });
  } catch (error) {
    logger.error('Error updating league member identity:', error);
    return NextResponse.json({ error: 'Failed to update team identity' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run route checks**

Run:

```bash
npm run test:unit -- tests/unit/leagueMemberIdentityRouteArchitecture.test.ts tests/unit/teamSymbol.test.ts
npx eslint 'src/app/api/leagues/[id]/members/me/route.ts' tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit the member identity API**

Run:

```bash
git add 'src/app/api/leagues/[id]/members/me/route.ts' tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
git commit -m "Add team identity member API"
```

---

### Task 4: Overview Team Symbol Wall

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Modify: `tests/unit/LeagueTabs.overview.test.tsx`

- [ ] **Step 1: Update overview test expectations first**

In `tests/unit/LeagueTabs.overview.test.tsx`, update the fixture members to include one symbol:

```ts
    teamLogoUrl: 'https://cdn.example.com/first-team.png',
```

Add a third member so fallback initials are tested:

```ts
  {
    id: 'member-3',
    leagueId: 'league-1',
    userId: 'user-3',
    role: 'member',
    teamName: 'Third Team',
    joinedAt: '2026-06-03T00:00:00.000Z',
    isActive: true,
  },
```

Replace table-specific assertions:

```ts
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.getByText('First Team')).toBeInTheDocument();
    expect(screen.getAllByText('Second Team').length).toBeGreaterThan(0);
```

With symbol-wall assertions:

```ts
    expect(screen.getByText('Team symbols')).toBeInTheDocument();
    expect(screen.getByText('12-team league')).toBeInTheDocument();
    expect(screen.queryByText('League table')).not.toBeInTheDocument();
    expect(screen.queryByText('ROLE')).not.toBeInTheDocument();
    expect(screen.queryByText('STATUS')).not.toBeInTheDocument();

    const firstTeamSymbol = screen.getByRole('img', { name: 'First Team symbol' });
    expect(firstTeamSymbol).toHaveAttribute('src', 'https://cdn.example.com/first-team.png');
    expect(screen.getByText('Second Team')).toBeInTheDocument();
    expect(screen.getByText('ST')).toBeInTheDocument();
    expect(screen.getByText('Third Team')).toBeInTheDocument();
    expect(screen.getByText('TT')).toBeInTheDocument();
```

Update the count assertion because the fixture now has three active members:

```ts
    expect(screen.getByText('3/4 teams')).toBeInTheDocument();
```

- [ ] **Step 2: Run the failing overview test**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx
```

Expected: FAIL because the UI still renders the table headers.

- [ ] **Step 3: Replace overview table with team symbol wall**

In `src/components/league/LeagueTabs.tsx`, change:

```ts
  const overviewTeams = activeMembers.slice(0, 5);
```

To:

```ts
  const overviewTeams = activeMembers.slice(0, league.maxTeams);
```

Replace the current `<div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">...</div>` team table block inside the overview section with:

```tsx
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Team symbols
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-950">
                          12-team league
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTabChange('teams')}
                        className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                      >
                        View teams
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                      {overviewTeams.map((member) => (
                        <div
                          key={member.id}
                          className="group flex min-h-36 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4 text-center transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-[0_18px_35px_-28px_rgba(15,23,42,0.45)]"
                        >
                          <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            {member.teamLogoUrl ? (
                              <img
                                src={member.teamLogoUrl}
                                alt={`${member.teamName || 'Team'} symbol`}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-lg font-semibold text-slate-700">
                                {getTeamInitials(member.teamName || 'Team')}
                              </span>
                            )}
                          </div>
                          <p className="mt-3 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-950">
                            {member.teamName || 'Unnamed team'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {getLeagueMemberRoleLabel(member, league)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
```

If Tailwind line clamp is not configured, replace `line-clamp-2` with:

```tsx
                          <p className="mt-3 min-h-10 text-sm font-semibold leading-5 text-slate-950">
```

Use the non-line-clamp version if `rg "line-clamp" src` returns no existing usage.

- [ ] **Step 4: Run overview checks**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx
npx eslint src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.overview.test.tsx
```

Expected: both PASS.

- [ ] **Step 5: Commit the overview symbol wall**

Run:

```bash
git add src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.overview.test.tsx
git commit -m "Show team symbols on league overview"
```

---

### Task 5: Settings Team Identity Form

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Create: `tests/unit/LeagueTabs.teamIdentity.test.tsx`
- Modify: `tests/unit/leagueSettingsUiArchitecture.test.ts`

- [ ] **Step 1: Add team identity UI architecture assertions**

In `tests/unit/leagueSettingsUiArchitecture.test.ts`, add:

```ts
  it('keeps team identity editing available to ordinary league members', () => {
    const leagueTabsSource = source();

    expect(leagueTabsSource).toContain('Team identity');
    expect(leagueTabsSource).toContain('Team symbol URL');
    expect(leagueTabsSource).toContain('Upload team symbol');
    expect(leagueTabsSource).toContain('`/api/leagues/${league.id}/members/me`');
    expect(leagueTabsSource).toContain("method: 'PATCH'");
    expect(leagueTabsSource.indexOf('Team identity')).toBeLessThan(
      leagueTabsSource.indexOf('<fieldset disabled={!isAdmin || isSaving}')
    );
  });
```

- [ ] **Step 2: Create the interaction test**

Create `tests/unit/LeagueTabs.teamIdentity.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, LeagueMember } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'settings' : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

const league: League = {
  id: 'league-1',
  name: 'Identity League',
  code: 'ABC12345',
  type: 'private',
  ownerId: 'owner-user',
  maxTeams: 12,
  categories: ['goals', 'tackles', 'inside50s'],
  tradeSettings: { tradeLimit: 10, tradeReview: 'none' },
  waiverWire: { waiverOrder: [], waiverPeriodHours: 24, waiverResetPolicy: 'weekly' },
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'preseason',
};

const members: LeagueMember[] = [
  {
    id: 'member-1',
    leagueId: 'league-1',
    userId: 'member-user',
    role: 'member',
    teamName: 'Member Team',
    joinedAt: '2026-06-01T00:00:00.000Z',
    isActive: true,
  },
];

describe('LeagueTabs team identity settings', () => {
  it('lets an ordinary member save a pasted team symbol URL', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            league: { id: 'league-1', name: 'Identity League', code: 'ABC12345', maxTeams: 12, locked: false },
            scoring: { scoringFormat: 'nine-category', categories: ['goals', 'tackles', 'inside50s'] },
            roster: { rosterSize: 18, benchSize: 4, positionLimits: { DEF: 6, MID: 8, RUC: 2, FWD: 6, BENCH: 4 } },
            draft: {
              draftDate: '2026-07-03T00:00:00.000Z',
              draftType: 'snake',
              timePerPick: 120,
              pickOrder: 'random',
              timeZone: 'Australia/Melbourne',
              autoPickRules: { enabled: true, strategy: 'queue-first' },
            },
            waiver: { waiverRule: 'weekly' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            member: {
              ...members[0],
              teamLogoUrl: 'https://cdn.example.com/member-team.png',
            },
          },
        }),
      });

    render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

    expect(await screen.findByText('Team identity')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Team symbol URL'), {
      target: { value: 'https://cdn.example.com/member-team.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save team symbol' }));

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenLastCalledWith(
        '/api/leagues/league-1/members/me',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamLogoUrl: 'https://cdn.example.com/member-team.png' }),
        },
        'member-user'
      );
    });

    expect(await screen.findByText('Team symbol saved.')).toBeInTheDocument();
  });

  it('rejects unsupported upload files before making a network request', async () => {
    authenticatedFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          league: { id: 'league-1', name: 'Identity League', code: 'ABC12345', maxTeams: 12, locked: false },
          scoring: { scoringFormat: 'nine-category', categories: ['goals', 'tackles', 'inside50s'] },
          roster: { rosterSize: 18, benchSize: 4, positionLimits: { DEF: 6, MID: 8, RUC: 2, FWD: 6, BENCH: 4 } },
          draft: {
            draftDate: '2026-07-03T00:00:00.000Z',
            draftType: 'snake',
            timePerPick: 120,
            pickOrder: 'random',
            timeZone: 'Australia/Melbourne',
            autoPickRules: { enabled: true, strategy: 'queue-first' },
          },
          waiver: { waiverRule: 'weekly' },
        },
      }),
    });

    render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

    const file = new File(['<svg></svg>'], 'symbol.svg', { type: 'image/svg+xml' });
    fireEvent.change(await screen.findByLabelText('Upload team symbol'), {
      target: { files: [file] },
    });

    expect(await screen.findByText('Upload a PNG, JPEG, or WebP image.')).toBeInTheDocument();
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the failing UI tests**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
```

Expected: FAIL because the team identity UI is not present.

- [ ] **Step 4: Add upload helper functions to `LeagueTabs.tsx`**

Add these constants and helpers near the other settings helpers in `src/components/league/LeagueTabs.tsx`:

```ts
const TEAM_SYMBOL_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEAM_SYMBOL_UPLOAD_MAX_BYTES = 2_000_000;
const TEAM_SYMBOL_CANVAS_SIZE = 256;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read image file.'));
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function resizeTeamSymbolDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TEAM_SYMBOL_CANVAS_SIZE;
      canvas.height = TEAM_SYMBOL_CANVAS_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not prepare image.'));
        return;
      }

      const size = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = Math.max(0, (image.naturalWidth - size) / 2);
      const sourceY = Math.max(0, (image.naturalHeight - size) / 2);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        size,
        size,
        0,
        0,
        TEAM_SYMBOL_CANVAS_SIZE,
        TEAM_SYMBOL_CANVAS_SIZE
      );
      resolve(canvas.toDataURL('image/webp', 0.82));
    };
    image.onerror = () => reject(new Error('Could not load image file.'));
    image.src = dataUrl;
  });
}
```

- [ ] **Step 5: Add member state and save handlers to `LeagueSettingsPanel`**

Change the `LeagueSettingsPanel` props to receive `currentMember` and `onMemberIdentityChange`:

```tsx
              <LeagueSettingsPanel
                league={league}
                memberCount={members.length}
                isAdmin={isAdmin}
                isActive
                currentUserId={currentUserId}
                currentMember={currentMember}
                onMemberIdentityChange={(nextMember) => {
                  const nextMembers = members.map((member) =>
                    member.id === nextMember.id ? { ...member, ...nextMember } : member
                  );
                  onMembersChange?.(nextMembers);
                }}
              />
```

Update the function signature:

```ts
function LeagueSettingsPanel({
  league,
  memberCount,
  isAdmin,
  isActive,
  currentUserId,
  currentMember,
  onMemberIdentityChange,
}: {
  league: League;
  memberCount: number;
  isAdmin: boolean;
  isActive: boolean;
  currentUserId?: string;
  currentMember?: LeagueMember;
  onMemberIdentityChange?: (member: LeagueMember) => void;
}) {
```

Add state after the existing `message` state:

```ts
  const [teamSymbolUrl, setTeamSymbolUrl] = useState(currentMember?.teamLogoUrl ?? '');
  const [teamSymbolMessage, setTeamSymbolMessage] = useState<LeagueSettingsMessage | null>(null);
  const [isSavingTeamSymbol, setIsSavingTeamSymbol] = useState(false);
```

Add effect:

```ts
  useEffect(() => {
    setTeamSymbolUrl(currentMember?.teamLogoUrl ?? '');
  }, [currentMember?.teamLogoUrl]);
```

Add handlers before `handleSaveSettings`:

```ts
  const saveTeamSymbol = async (nextTeamSymbolUrl: string) => {
    if (!currentUserId || !currentMember) return;

    try {
      setIsSavingTeamSymbol(true);
      setTeamSymbolMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/members/me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamLogoUrl: nextTeamSymbolUrl }),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      const nextMember = isRecord(payload.data) && isRecord(payload.data.member)
        ? ({
            ...currentMember,
            ...payload.data.member,
          } as LeagueMember)
        : {
            ...currentMember,
            teamLogoUrl: nextTeamSymbolUrl || undefined,
          };

      setTeamSymbolUrl(nextMember.teamLogoUrl ?? '');
      onMemberIdentityChange?.(nextMember);
      setTeamSymbolMessage({ type: 'success', text: 'Team symbol saved.' });
    } catch (error) {
      setTeamSymbolMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save team symbol.',
      });
    } finally {
      setIsSavingTeamSymbol(false);
    }
  };

  const handleTeamSymbolUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!TEAM_SYMBOL_UPLOAD_TYPES.has(file.type)) {
      setTeamSymbolMessage({ type: 'error', text: 'Upload a PNG, JPEG, or WebP image.' });
      return;
    }
    if (file.size > TEAM_SYMBOL_UPLOAD_MAX_BYTES) {
      setTeamSymbolMessage({ type: 'error', text: 'Upload an image smaller than 2 MB.' });
      return;
    }

    try {
      setTeamSymbolMessage(null);
      const dataUrl = await readFileAsDataUrl(file);
      const resizedDataUrl = await resizeTeamSymbolDataUrl(dataUrl);
      setTeamSymbolUrl(resizedDataUrl);
      await saveTeamSymbol(resizedDataUrl);
    } catch (error) {
      setTeamSymbolMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to upload team symbol.',
      });
    }
  };
```

- [ ] **Step 6: Add the Team Identity section before the admin fieldset**

In the `LeagueSettingsPanel` JSX, insert this section after the message block and before `<fieldset disabled={!isAdmin || isSaving}`:

```tsx
      {currentMember && (
        <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-[color:var(--league-text)]">
                Team identity
              </h3>
              <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                Set the symbol shown for {currentMember.teamName} across this league.
              </p>
            </div>
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {teamSymbolUrl ? (
                <img
                  src={teamSymbolUrl}
                  alt={`${currentMember.teamName} symbol preview`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-semibold text-slate-700">
                  {getTeamInitials(currentMember.teamName)}
                </span>
              )}
            </div>
          </div>

          {teamSymbolMessage && (
            <div
              role="status"
              className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                teamSymbolMessage.type === 'success'
                  ? 'border-[color:var(--league-border)] bg-[color:var(--league-page)] text-[color:var(--league-text)]'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {teamSymbolMessage.text}
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Team symbol URL
              <input
                type="url"
                value={teamSymbolUrl.startsWith('data:') ? '' : teamSymbolUrl}
                placeholder="https://example.com/team-symbol.png"
                onChange={(event) => setTeamSymbolUrl(event.target.value)}
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void saveTeamSymbol(teamSymbolUrl)}
                disabled={isSavingTeamSymbol}
                className="inline-flex h-10 items-center justify-center rounded-md bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
              >
                {isSavingTeamSymbol ? 'Saving...' : 'Save team symbol'}
              </button>
              <button
                type="button"
                onClick={() => void saveTeamSymbol('')}
                disabled={isSavingTeamSymbol}
                className="inline-flex h-10 items-center justify-center rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
              >
                Clear
              </button>
            </div>
          </div>

          <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
            Upload team symbol
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void handleTeamSymbolUpload(event.target.files?.[0])}
              className="block w-full text-sm text-[color:var(--league-text-muted)] file:mr-4 file:rounded-md file:border-0 file:bg-[color:var(--league-page)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[color:var(--league-text)]"
            />
          </label>
        </section>
      )}
```

- [ ] **Step 7: Run team identity UI tests**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
npx eslint src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit team identity UI**

Run:

```bash
git add src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
git commit -m "Add team symbol settings"
```

---

### Task 6: Full Verification And Browser QA

**Files:**
- No code files unless verification exposes a defect.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm run test:unit -- tests/unit/teamSymbol.test.ts tests/unit/leagueMembership.test.ts tests/unit/leagueMemberIdentityRouteArchitecture.test.ts tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
```

Expected: all listed test files PASS. Existing Firebase config warnings are acceptable if the process exits 0.

- [ ] **Step 2: Run lint and typecheck**

Run:

```bash
npx eslint src/lib/teamSymbol.ts 'src/app/api/leagues/[id]/members/me/route.ts' src/components/league/LeagueTabs.tsx tests/unit/teamSymbol.test.ts tests/unit/leagueMemberIdentityRouteArchitecture.test.ts tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
npm run typecheck
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Browser verify the overview symbol wall**

Run this Playwright smoke check while `npm run dev` is serving `http://localhost:3000`:

```bash
node - <<'NODE'
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', msg => {
    if (['warning', 'error'].includes(msg.type())) logs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', error => logs.push({ type: 'pageerror', text: error.message }));

  await page.goto('http://localhost:3000/leagues/cmezlicop0002uxzjdtavv4mk', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForFunction(() => (document.body?.innerText || '').includes('TEAM SYMBOLS'), null, {
    timeout: 20000,
  });

  const desktop = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      hasTeamSymbols: text.includes('TEAM SYMBOLS'),
      hasLeagueTable: text.includes('League table'),
      hasRoleHeader: text.includes('ROLE'),
      hasStatusHeader: text.includes('STATUS'),
      imageCount: document.querySelectorAll('img[alt$=" symbol"]').length,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  await page.screenshot({ path: '/tmp/statly-team-symbols-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/statly-team-symbols-mobile.png', fullPage: true });
  const mobile = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));

  await browser.close();
  console.log(JSON.stringify({ desktop, mobile, logs }, null, 2));
})();
NODE
```

Expected:

```json
{
  "desktop": {
    "hasTeamSymbols": true,
    "hasLeagueTable": false,
    "hasRoleHeader": false,
    "hasStatusHeader": false,
    "imageCount": 1,
    "scrollWidth": 1440,
    "viewportWidth": 1440
  },
  "mobile": {
    "scrollWidth": 390,
    "viewportWidth": 390
  },
  "logs": []
}
```

The exact `imageCount` may be higher if local fixture data has more symbols. It must be at least `1`.

- [ ] **Step 4: Browser verify settings URL save**

Manual browser flow:

1. Open `http://localhost:3000/leagues/cmezlicop0002uxzjdtavv4mk?tab=settings`.
2. Confirm the settings tab shows `Team identity` above commissioner settings.
3. Paste `https://placehold.co/160x160/123456/ffffff.png?text=TT` into `Team symbol URL`.
4. Click `Save team symbol`.
5. Confirm `Team symbol saved.` appears.
6. Return to Overview.
7. Confirm the current team tile displays the image instead of initials.

Expected: no framework overlay, no console errors, no mobile horizontal overflow.

- [ ] **Step 5: Final council and reviewed commit**

Run:

```bash
git status --short
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether the team symbols league overview and team identity settings implementation should be committed. Verification passed: focused unit tests, eslint on touched files, typecheck, diff whitespace, desktop/mobile browser render, settings save flow. Unrelated dirty files are not staged."
```

If the council returns `CHAIRMAN DECISION 2: COMMIT`, run:

```bash
npm run codex:commit:reviewed -- "Add team symbols to league overview"
```

Expected: reviewed commit succeeds, and `git status --short` shows only unrelated pre-existing files such as `prisma/dev.db`.

---

## Self-Review

**Spec coverage:** The plan replaces the overview table with a 12-team symbol wall in Task 4. It adds the team-owned symbol field to the data contract in Task 1. It supports pasted URLs and uploaded images in settings in Task 5. It adds route, validation, unit, and browser verification in Tasks 2, 3, and 6.

**Placeholder scan:** No `TBD`, `TODO`, "implement later", or unbounded "add validation" placeholders remain. Validation rules and exact errors are specified in `src/lib/teamSymbol.ts`.

**Type consistency:** The plan uses `teamLogoUrl` consistently across Prisma, Firestore helpers, API payloads, `LeagueMember`, and UI rendering.

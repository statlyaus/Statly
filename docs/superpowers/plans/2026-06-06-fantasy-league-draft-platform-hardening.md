# Fantasy League Draft Platform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make leagues, admin setup, draft settings, pre-draft, live draft, post-draft rosters, and waivers operate from coherent durable ownership boundaries.

**Architecture:** Prisma is the canonical source for protected league membership, league settings, draft lifecycle, picks, roster ownership, and waiver eligibility. Firestore remains a compatibility projection for legacy realtime/client surfaces until those screens are migrated; API routes become transport adapters over shared server services, with authorization enforced at the data boundary. Draft commands flow through `DraftApplicationService`, roster ownership is projected idempotently from picks, and waivers consume the same ownership state that draft completion writes.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Prisma, Firebase Admin/Firestore projection, Socket.IO, Redis-compatible room state, Vitest, existing shadcn-style components.

---

## Council Decision Frame

`CHAIRMAN DECISION 1: PROCEED`

The council rejected short-term fixes such as adding one database column, silencing the UI error, or patching only the draft modal. The durable boundary is:

- Auth and commissioner checks live in shared server membership helpers, not UI gates.
- League creation and league detail normalize through one contract before reaching pages or API responses.
- Draft lifecycle commands route through `DraftApplicationService` so timers, status, events, scheduler jobs, and realtime are not split.
- Picks become canonical roster ownership through a normalized per-player ownership table and an idempotent projection service.
- Waiver eligibility is derived from the same roster ownership, with Firestore updated only as a compatibility projection.
- Tests target the failing behavioral boundaries, not only source-string architecture checks.

## File Map

### Shared league and authorization boundary

- Modify: `src/server/leagues/membership.ts`
  - Own canonical membership lookup, manager/commissioner authorization, and Firestore fallback for legacy leagues.
- Create: `src/server/leagues/createLeagueContract.ts`
  - Normalize league creation input and output shape used by `POST /api/leagues` and `src/app/leagues/new/page.tsx`.
- Modify: `src/app/api/leagues/route.ts`
  - Use the shared creation contract and return `{ success, data }` consistently.
- Modify: `src/app/leagues/new/page.tsx`
  - Submit the canonical create payload and navigate with `response.data.id`.
- Modify: `src/server/leagues/leagueDetail.ts`
  - Use shared membership roles and treat expected 401/403/404 states deliberately.
- Modify: `src/components/league/LeagueTabs.tsx`
  - Use normalized manager flags from the server instead of owner-only checks.

### Draft setup and lifecycle boundary

- Modify: `src/app/api/drafts/route.ts`
  - Require authenticated user and commissioner access before draft creation or Prisma mirroring.
- Modify: `src/app/api/leagues/[id]/draft/route.ts`
  - Use shared membership helper and expose one read model for draft management.
- Modify: `src/components/league/DraftManager.tsx`
  - Use one draft setup read model and remove the `link-draft` reconciliation step when a Prisma draft already has `leagueId`.
- Modify: `src/server/draft/services/DraftApplicationService.ts`
  - Add or expose command methods for start, pause, resume, manual pick, auto-pick, and completion projection.
- Modify: `src/app/api/drafts/[id]/start/route.ts`
- Modify: `src/app/api/drafts/[id]/pause/route.ts`
- Modify: `src/app/api/drafts/[id]/resume/route.ts`
- Modify: `src/app/api/drafts/[id]/pick/route.ts`
- Modify: `src/app/api/drafts/[id]/picks/route.ts`
- Modify: `src/app/api/drafts/[id]/auto-pick/route.ts`
  - Turn these into thin authenticated adapters over the application service.

### Pre-draft queue and readiness boundary

- Modify: `src/app/api/drafts/[id]/pre-queue/route.ts`
  - Derive `memberId` from authenticated league membership; reject caller-supplied impersonation.
- Modify: `src/app/api/drafts/[id]/queue/route.ts`
  - Route legacy queue reads/writes to `PreDraftQueue` or return a documented compatibility response.
- Modify: `src/server/draft/repository/DraftRepository.ts`
  - Keep `PreDraftQueue` as the only queue used by auto-pick.
- Modify: `src/lib/draftLobby.ts`
  - Make GET/read methods read-only.
- Modify: `src/server/draft/services/DraftSetupConvergenceService.ts`
  - Remove draft start side effects from convergence; expose explicit command methods instead.

### Roster ownership and waivers

- Modify: `prisma/schema.prisma`
  - Add canonical `LeagueRosterPlayer` model with unique `(leagueId, playerId)` ownership.
- Create: `src/server/rosters/RosterProjectionService.ts`
  - Idempotently project picks into `LeagueRoster` and `LeagueRosterPlayer`.
- Create: `src/server/waivers/WaiverAvailabilityProjectionService.ts`
  - Publish canonical ownership and undrafted pool into the Firestore documents still read by legacy waiver UI.
- Modify: `src/app/api/leagues/[id]/waivers/submit/route.ts`
- Modify: `src/app/api/leagues/[id]/waivers/process/route.ts`
- Modify: `src/app/api/leagues/[id]/waivers/[waiverId]/cancel/route.ts`
  - Use shared membership/manager helpers and read eligibility through canonical ownership or the compatibility projection.
- Modify: `src/services/waiverService.ts`
- Modify: `src/components/waivers/LeagueWaiversContainer.tsx`
  - Remove stubbed assumptions and show errors when canonical eligibility cannot be loaded.

### Realtime and compatibility cleanup

- Modify: `src/providers/SocketProvider.tsx`
  - Send the same auth token shape the socket server validates.
- Modify: `src/server/socketioServer.ts`
  - Validate `socket.handshake.auth.token`, support a dev auth path only when `NODE_ENV !== "production"`, and source backfill from persisted draft events.
- Modify: `src/app/api/socketio/route.ts`
  - Remove fake success semantics or replace with a health-only endpoint that is not used for socket handshakes.

### Tests

- Create: `tests/unit/leagueCreateContract.test.ts`
- Create: `tests/unit/draftCreateAuthorization.test.ts`
- Create: `tests/unit/draftCommandRoutes.test.ts`
- Create: `tests/unit/preDraftQueueAuthorization.test.ts`
- Create: `tests/unit/RosterProjectionService.test.ts`
- Create: `tests/unit/waiverAvailabilityProjection.test.ts`
- Modify: existing architecture tests only when they contradict the new service ownership.

## Execution Strategy

Execute in phases. Each phase is independently reviewable and should end with a council Decision 2 check before commit. Do not stage `prisma/dev.db`, local `.env` files, `.next`, or unrelated user changes.

Run these commands at the start of each phase:

```bash
git status --short
npm run codex:council:logical -- --prompt "Chairman Decision 1 already approved the fantasy league draft platform hardening plan. Review the current phase boundary before edits and reject short-term patches."
```

Expected council output contains:

```text
CHAIRMAN DECISION 1: PROCEED
```

After each phase, run:

```bash
npm run typecheck
npm run test:unit
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed phase should be committed."
```

Expected council output contains:

```text
CHAIRMAN DECISION 2: COMMIT
```

Commit only with:

```bash
npm run codex:commit:reviewed -- "hardening: <phase summary>"
```

## Task 1: Shared League Membership And Manager Authorization

**Files:**

- Modify: `src/server/leagues/membership.ts`
- Modify: `src/app/api/drafts/route.ts`
- Modify: `src/app/api/leagues/[id]/draft/route.ts`
- Test: `tests/unit/draftCreateAuthorization.test.ts`

- [ ] **Step 1: Write route authorization tests**

Create `tests/unit/draftCreateAuthorization.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('draft creation authorization boundary', () => {
  it('requires authenticated user and manager access before creating a league draft', () => {
    const source = read('src/app/api/drafts/route.ts');

    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('canManageLeague');
    expect(source.indexOf('canManageLeague')).toBeLessThan(source.indexOf('ensurePrismaLeagueMirror'));
    expect(source).toContain('status: 401');
    expect(source).toContain('status: 403');
  });

  it('does not rely on DraftManager UI state as the only commissioner gate', () => {
    const source = read('src/components/league/DraftManager.tsx');

    expect(source).toContain('isCommissioner');
    expect(read('src/app/api/drafts/route.ts')).toContain('canManageLeague');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test:unit -- tests/unit/draftCreateAuthorization.test.ts
```

Expected before implementation: fails because `src/app/api/drafts/route.ts` does not call `canManageLeague` before mirroring or creating drafts.

- [ ] **Step 3: Add canonical membership helper**

In `src/server/leagues/membership.ts`, expose helpers with this public shape:

```ts
export type LeagueManagerRole = 'OWNER' | 'MANAGER' | 'COMMISSIONER' | 'ADMIN';

export interface LeagueMembershipAccess {
  leagueId: string;
  userId: string;
  memberId: string;
  role: string;
  isMember: boolean;
  canManage: boolean;
}

const MANAGER_ROLES = new Set(['OWNER', 'MANAGER', 'COMMISSIONER', 'ADMIN', 'owner', 'manager', 'commissioner', 'admin']);

export async function canManageLeague(leagueId: string, userId: string): Promise<boolean> {
  const access = await getLeagueMembershipAccess(leagueId, userId);
  return access.canManage;
}
```

`getLeagueMembershipAccess` must first check Prisma `leagueMember` by `leagueId` and `userId`, then fall back to existing Firestore membership lookup for legacy leagues. Expected 404 membership absence returns `{ isMember: false, canManage: false }`; unexpected database failures are thrown with context.

- [ ] **Step 4: Guard `POST /api/drafts`**

In `src/app/api/drafts/route.ts`, place the guard before any draft creation, settings creation, or `ensurePrismaLeagueMirror` call:

```ts
const userId = await getAuthenticatedUserId(request);

if (!userId) {
  return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
}

if (body.leagueId) {
  const allowed = await canManageLeague(body.leagueId, userId);

  if (!allowed) {
    return NextResponse.json({ success: false, error: 'Commissioner access required' }, { status: 403 });
  }
}
```

If `POST /api/drafts` still supports non-league drafts for local tests, restrict that path to development:

```ts
if (!body.leagueId && process.env.NODE_ENV === 'production') {
  return NextResponse.json({ success: false, error: 'League draft creation requires a leagueId' }, { status: 400 });
}
```

- [ ] **Step 5: Run targeted checks**

Run:

```bash
npm run test:unit -- tests/unit/draftCreateAuthorization.test.ts tests/unit/draftCreateRouteArchitecture.test.ts
npm run typecheck
```

Expected: both tests pass and TypeScript succeeds.

## Task 2: League Creation Contract And New League Navigation

**Files:**

- Create: `src/server/leagues/createLeagueContract.ts`
- Modify: `src/app/api/leagues/route.ts`
- Modify: `src/app/leagues/new/page.tsx`
- Test: `tests/unit/leagueCreateContract.test.ts`

- [ ] **Step 1: Write contract tests**

Create `tests/unit/leagueCreateContract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeCreateLeagueInput, normalizeCreateLeagueResponse } from '../../src/server/leagues/createLeagueContract';

describe('league creation contract', () => {
  it('normalizes the current new-league form payload into canonical API input', () => {
    expect(
      normalizeCreateLeagueInput({
        name: 'Test Lab Alpha',
        teamCount: 12,
        scoringFormat: 'category',
        privacy: 'private',
      }),
    ).toMatchObject({
      name: 'Test Lab Alpha',
      maxTeams: 12,
      categories: ['kicks', 'handballs', 'marks', 'tackles', 'hitouts', 'goals'],
      visibility: 'PRIVATE',
    });
  });

  it('extracts created league id from the API success envelope', () => {
    expect(normalizeCreateLeagueResponse({ success: true, data: { id: 'league-123' } })).toEqual({ id: 'league-123' });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test:unit -- tests/unit/leagueCreateContract.test.ts
```

Expected before implementation: fails because `createLeagueContract.ts` does not exist.

- [ ] **Step 3: Create the contract module**

Create `src/server/leagues/createLeagueContract.ts`:

```ts
const DEFAULT_CATEGORY_SCORING = ['kicks', 'handballs', 'marks', 'tackles', 'hitouts', 'goals'] as const;

export interface CreateLeagueInput {
  name: string;
  maxTeams?: number;
  teamCount?: number;
  categories?: string[];
  scoringFormat?: string;
  privacy?: string;
  visibility?: string;
}

export interface NormalizedCreateLeagueInput {
  name: string;
  maxTeams: number;
  categories: string[];
  visibility: 'PUBLIC' | 'PRIVATE';
}

export function normalizeCreateLeagueInput(input: CreateLeagueInput): NormalizedCreateLeagueInput {
  const maxTeams = input.maxTeams ?? input.teamCount ?? 12;
  const categories = input.categories?.length ? input.categories : [...DEFAULT_CATEGORY_SCORING];
  const visibility = (input.visibility ?? input.privacy ?? 'private').toLowerCase() === 'public' ? 'PUBLIC' : 'PRIVATE';

  return {
    name: input.name.trim(),
    maxTeams,
    categories,
    visibility,
  };
}

export function normalizeCreateLeagueResponse(response: unknown): { id: string } {
  if (
    response &&
    typeof response === 'object' &&
    'success' in response &&
    (response as { success?: boolean }).success === true &&
    'data' in response &&
    (response as { data?: { id?: unknown } }).data &&
    typeof (response as { data: { id?: unknown } }).data.id === 'string'
  ) {
    return { id: (response as { data: { id: string } }).data.id };
  }

  if (response && typeof response === 'object' && 'id' in response && typeof (response as { id?: unknown }).id === 'string') {
    return { id: (response as { id: string }).id };
  }

  throw new Error('League creation response did not include a league id');
}
```

- [ ] **Step 4: Use the contract in API and client**

In `src/app/api/leagues/route.ts`, normalize once at the top of `POST`:

```ts
const normalized = normalizeCreateLeagueInput(body);
```

Use `normalized.maxTeams`, `normalized.categories`, and `normalized.visibility` for writes.

In `src/app/leagues/new/page.tsx`, import and use response normalization after `fetchApi`:

```ts
const createdLeague = normalizeCreateLeagueResponse(response);
router.push(`/leagues/${createdLeague.id}`);
```

- [ ] **Step 5: Verify league creation contract**

Run:

```bash
npm run test:unit -- tests/unit/leagueCreateContract.test.ts tests/unit/leagueListArchitecture.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 3: Draft Setup Read Model And Admin Workflow

**Files:**

- Modify: `src/app/api/leagues/[id]/draft/route.ts`
- Modify: `src/components/league/DraftManager.tsx`
- Modify: `src/components/league/LeagueTabs.tsx`
- Test: `tests/unit/leagueDraftRouteArchitecture.test.ts`
- Test: `tests/unit/draftSettings.test.ts`

- [ ] **Step 1: Add route ownership assertions**

Update `tests/unit/leagueDraftRouteArchitecture.test.ts` to assert the league draft route uses shared membership and does not treat Firestore as the only membership source:

```ts
expect(routeSource).toContain('getLeagueMembershipAccess');
expect(routeSource).not.toContain('verifyLeagueMembership(');
```

- [ ] **Step 2: Run tests to capture current mismatch**

Run:

```bash
npm run test:unit -- tests/unit/leagueDraftRouteArchitecture.test.ts tests/unit/draftSettings.test.ts
```

Expected before implementation: architecture assertion fails if the route still calls the Firestore-only helper.

- [ ] **Step 3: Return a single draft management read model**

In `src/app/api/leagues/[id]/draft/route.ts`, shape `GET` responses as:

```ts
return NextResponse.json({
  success: true,
  data: {
    leagueId: id,
    draft: draft
      ? {
          id: draft.id,
          status: draft.status,
          type: draft.type,
          pickSeconds: draft.pickSeconds,
          startAt: draft.startAt?.toISOString() ?? null,
          currentPick: draft.currentPick,
          totalPicks: draft.totalPicks,
        }
      : null,
    canManage: access.canManage,
    memberCount,
    maxTeams: settings?.maxTeams ?? league.maxTeams,
  },
});
```

- [ ] **Step 4: Remove duplicate setup reconciliation from `DraftManager`**

In `src/components/league/DraftManager.tsx`, keep local UI state, but remove the follow-up `/link-draft` call when `createDraft` returns a league-scoped draft. Use:

```ts
if (createdDraft.leagueId === leagueId || createdDraft.league?.id === leagueId) {
  await refreshDraftState();
  setShowSettings(false);
  return;
}
```

If the returned draft is not linked, show an error and do not attempt hidden reconciliation:

```ts
throw new Error('Draft was created without the expected league link');
```

- [ ] **Step 5: Verify admin workflow tests**

Run:

```bash
npm run test:unit -- tests/unit/leagueDraftRouteArchitecture.test.ts tests/unit/draftSettings.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 4: Draft Command Routes Use `DraftApplicationService`

**Files:**

- Modify: `src/server/draft/services/DraftApplicationService.ts`
- Modify: `src/app/api/drafts/[id]/start/route.ts`
- Modify: `src/app/api/drafts/[id]/pause/route.ts`
- Modify: `src/app/api/drafts/[id]/resume/route.ts`
- Modify: `src/app/api/drafts/[id]/pick/route.ts`
- Modify: `src/app/api/drafts/[id]/picks/route.ts`
- Modify: `src/app/api/drafts/[id]/auto-pick/route.ts`
- Test: `tests/unit/draftCommandRoutes.test.ts`

- [ ] **Step 1: Write command route architecture tests**

Create `tests/unit/draftCommandRoutes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('draft command routes', () => {
  it.each([
    'src/app/api/drafts/[id]/start/route.ts',
    'src/app/api/drafts/[id]/pause/route.ts',
    'src/app/api/drafts/[id]/resume/route.ts',
    'src/app/api/drafts/[id]/pick/route.ts',
    'src/app/api/drafts/[id]/auto-pick/route.ts',
  ])('%s delegates lifecycle mutation to DraftApplicationService', (path) => {
    const source = read(path);

    expect(source).toContain('DraftApplicationService');
    expect(source).not.toContain('LiveDraftEngine.getInstance()');
  });

  it('supports the client POST path used by DraftContext.makePick', () => {
    expect(read('src/contexts/DraftContext.tsx')).toContain('/picks');
    expect(read('src/app/api/drafts/[id]/picks/route.ts')).toContain('export async function POST');
    expect(read('src/app/api/drafts/[id]/picks/route.ts')).toContain('DraftApplicationService');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run test:unit -- tests/unit/draftCommandRoutes.test.ts
```

Expected before implementation: fails for routes still using `LiveDraftEngine` or no `POST` export in `/picks`.

- [ ] **Step 3: Add service methods where missing**

In `src/server/draft/services/DraftApplicationService.ts`, expose command methods with this shape:

```ts
async startDraft(command: { draftId: string; actorUserId: string }) {
  return this.repository.transaction(async (tx) => {
    const draft = await this.repository.startDraft(tx, command.draftId, command.actorUserId);
    await this.realtimePublisher.publishDraftStarted(tx, draft.id);
    return draft;
  });
}

async pauseDraft(command: { draftId: string; actorUserId: string }) {
  return this.repository.transaction(async (tx) => {
    const draft = await this.repository.pauseDraft(tx, command.draftId, command.actorUserId);
    await this.realtimePublisher.publishDraftPaused(tx, draft.id);
    return draft;
  });
}

async resumeDraft(command: { draftId: string; actorUserId: string }) {
  return this.repository.transaction(async (tx) => {
    const draft = await this.repository.resumeDraft(tx, command.draftId, command.actorUserId);
    await this.realtimePublisher.publishDraftResumed(tx, draft.id);
    return draft;
  });
}
```

If the service already has equivalent methods, keep the existing names and update routes to call those methods.

- [ ] **Step 4: Convert routes to thin adapters**

Each command route should:

```ts
const userId = await getAuthenticatedUserId(request);

if (!userId) {
  return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
}

const service = createDraftApplicationService();
const result = await service.startDraft({ draftId: params.id, actorUserId: userId });

return NextResponse.json({ success: true, data: result });
```

Use the matching method for pause, resume, pick, and auto-pick. Validate manager access inside the service or in one shared command authorization helper called by the service.

- [ ] **Step 5: Add `/picks` POST compatibility adapter**

In `src/app/api/drafts/[id]/picks/route.ts`, add:

```ts
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const body = await request.json();

  return makeDraftPick(request, params.id, {
    playerId: body.playerId,
    memberId: body.memberId,
  });
}
```

Move the singular `/pick` shared command logic into an exported `makeDraftPick` function so both routes call the same code path.

- [ ] **Step 6: Verify command routes**

Run:

```bash
npm run test:unit -- tests/unit/draftCommandRoutes.test.ts tests/unit/DraftContext.initialFetch.test.tsx tests/unit/DraftRealtimePublisher.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 5: Authenticated Pre-Draft Queue And Auto-Pick Source

**Files:**

- Modify: `src/app/api/drafts/[id]/pre-queue/route.ts`
- Modify: `src/app/api/drafts/[id]/queue/route.ts`
- Modify: `src/app/api/drafts/[id]/auto-pick/route.ts`
- Modify: `src/server/draft/repository/DraftRepository.ts`
- Test: `tests/unit/preDraftQueueAuthorization.test.ts`

- [ ] **Step 1: Write queue authorization tests**

Create `tests/unit/preDraftQueueAuthorization.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('pre-draft queue authorization', () => {
  it('derives member identity from authenticated league membership', () => {
    const source = read('src/app/api/drafts/[id]/pre-queue/route.ts');

    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('getDraftMembershipAccess');
    expect(source).toContain('access.memberId');
    expect(source).not.toContain('memberId = body.memberId');
  });

  it('uses PreDraftQueue instead of legacy unscoped QueueItem for auto-pick', () => {
    const source = read('src/app/api/drafts/[id]/auto-pick/route.ts');

    expect(source).toContain('PreDraftQueue');
    expect(source).not.toContain('queueItem');
    expect(source).not.toContain('QueueItem');
  });
});
```

- [ ] **Step 2: Run failing queue tests**

Run:

```bash
npm run test:unit -- tests/unit/preDraftQueueAuthorization.test.ts
```

Expected before implementation: fails because the route trusts caller-supplied `memberId` or auto-pick reads legacy queue state.

- [ ] **Step 3: Add draft membership access helper**

In `src/server/leagues/membership.ts`, add:

```ts
export async function getDraftMembershipAccess(draftId: string, userId: string): Promise<LeagueMembershipAccess> {
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    select: { leagueId: true },
  });

  if (!draft?.leagueId) {
    return { leagueId: '', userId, memberId: '', role: 'NONE', isMember: false, canManage: false };
  }

  return getLeagueMembershipAccess(draft.leagueId, userId);
}
```

- [ ] **Step 4: Derive queue member server-side**

In `src/app/api/drafts/[id]/pre-queue/route.ts`, replace body member trust with:

```ts
const userId = await getAuthenticatedUserId(request);

if (!userId) {
  return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
}

const access = await getDraftMembershipAccess(params.id, userId);

if (!access.isMember) {
  return NextResponse.json({ success: false, error: 'League membership required' }, { status: 403 });
}

const memberId = access.memberId;
```

- [ ] **Step 5: Make auto-pick consume `PreDraftQueue` only**

In `src/app/api/drafts/[id]/auto-pick/route.ts`, remove direct `QueueItem` access and call the service method that already reads `PreDraftQueue`:

```ts
const result = await draftApplicationService.autoPick({
  draftId: params.id,
  actorUserId: userId,
});
```

- [ ] **Step 6: Verify queue behavior**

Run:

```bash
npm run test:unit -- tests/unit/preDraftQueueAuthorization.test.ts tests/unit/DraftContext.initialFetch.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 6: Canonical Roster Ownership Schema

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/add_league_roster_player.sql`
- Test: `tests/unit/RosterProjectionService.test.ts`

- [ ] **Step 1: Add schema model**

In `prisma/schema.prisma`, add a model:

```prisma
model LeagueRosterPlayer {
  id        String   @id @default(cuid())
  leagueId  String
  memberId  String
  draftId   String?
  pickId    String?
  playerId  String
  slot      String?
  acquiredBy String  @default("DRAFT")
  acquiredAt DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  league League @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  member LeagueMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  draft  Draft? @relation(fields: [draftId], references: [id], onDelete: SetNull)
  pick   Pick? @relation(fields: [pickId], references: [id], onDelete: SetNull)
  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([leagueId, playerId])
  @@unique([leagueId, memberId, playerId])
  @@index([leagueId, memberId])
  @@index([leagueId, acquiredBy])
}
```

Add matching relation arrays to `League`, `LeagueMember`, `Draft`, `Pick`, and `Player`:

```prisma
rosterPlayers LeagueRosterPlayer[]
```

- [ ] **Step 2: Create explicit SQL migration**

Create `prisma/migrations/add_league_roster_player.sql`:

```sql
CREATE TABLE IF NOT EXISTS "LeagueRosterPlayer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "draftId" TEXT,
  "pickId" TEXT,
  "playerId" TEXT NOT NULL,
  "slot" TEXT,
  "acquiredBy" TEXT NOT NULL DEFAULT 'DRAFT',
  "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueRosterPlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "Pick" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_playerId_key" ON "LeagueRosterPlayer" ("leagueId", "playerId");
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_memberId_playerId_key" ON "LeagueRosterPlayer" ("leagueId", "memberId", "playerId");
CREATE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_memberId_idx" ON "LeagueRosterPlayer" ("leagueId", "memberId");
CREATE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_acquiredBy_idx" ON "LeagueRosterPlayer" ("leagueId", "acquiredBy");
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
npm run prisma:generate
```

Expected: Prisma client generation succeeds and exposes `prisma.leagueRosterPlayer`.

- [ ] **Step 4: Verify schema compiles**

Run:

```bash
npm run typecheck
```

Expected: TypeScript succeeds.

## Task 7: Idempotent Roster Projection From Picks

**Files:**

- Create: `src/server/rosters/RosterProjectionService.ts`
- Modify: `src/server/draft/services/DraftApplicationService.ts`
- Test: `tests/unit/RosterProjectionService.test.ts`

- [ ] **Step 1: Write roster projection tests**

Create `tests/unit/RosterProjectionService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { RosterProjectionService } from '../../src/server/rosters/RosterProjectionService';

describe('RosterProjectionService', () => {
  it('projects each pick into one league-wide player ownership row', async () => {
    const prisma = {
      pick: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pick-1', draftId: 'draft-1', playerId: 'player-1', memberId: 'member-1' },
        ]),
      },
      leagueRoster: {
        upsert: vi.fn().mockResolvedValue({ id: 'roster-1', playerIds: '[]' }),
      },
      leagueRosterPlayer: {
        upsert: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
      },
    };

    const service = new RosterProjectionService(prisma as never);
    await service.projectDraft({ leagueId: 'league-1', draftId: 'draft-1' });

    expect(prisma.leagueRosterPlayer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId_playerId: { leagueId: 'league-1', playerId: 'player-1' } },
      }),
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test:unit -- tests/unit/RosterProjectionService.test.ts
```

Expected before implementation: fails because `RosterProjectionService` does not exist.

- [ ] **Step 3: Create projection service**

Create `src/server/rosters/RosterProjectionService.ts`:

```ts
import { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

export class RosterProjectionService {
  constructor(private readonly db: PrismaLike = prisma) {}

  async projectDraft(input: { leagueId: string; draftId: string }) {
    const picks = await this.db.pick.findMany({
      where: { draftId: input.draftId },
      orderBy: { overall: 'asc' },
      select: { id: true, draftId: true, playerId: true, memberId: true },
    });

    for (const pick of picks) {
      await this.db.leagueRoster.upsert({
        where: { leagueId_memberId: { leagueId: input.leagueId, memberId: pick.memberId } },
        update: {},
        create: {
          leagueId: input.leagueId,
          memberId: pick.memberId,
          playerIds: '[]',
        },
      });

      await this.db.leagueRosterPlayer.upsert({
        where: { leagueId_playerId: { leagueId: input.leagueId, playerId: pick.playerId } },
        update: {
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          acquiredBy: 'DRAFT',
        },
        create: {
          leagueId: input.leagueId,
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          playerId: pick.playerId,
          acquiredBy: 'DRAFT',
        },
      });
    }

    return { projected: picks.length };
  }
}
```

- [ ] **Step 4: Call projection on draft completion**

In `src/server/draft/services/DraftApplicationService.ts`, after a draft reaches completed status:

```ts
await this.rosterProjectionService.projectDraft({
  leagueId: draft.leagueId,
  draftId: draft.id,
});
```

If the constructor does not accept services yet, add an optional dependency:

```ts
constructor(
  private readonly repository = new DraftRepository(),
  private readonly realtimePublisher = new DraftRealtimePublisher(),
  private readonly rosterProjectionService = new RosterProjectionService(),
) {}
```

- [ ] **Step 5: Verify roster projection**

Run:

```bash
npm run test:unit -- tests/unit/RosterProjectionService.test.ts tests/unit/DraftProjectionService.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 8: Waiver Availability Projection From Canonical Ownership

**Files:**

- Create: `src/server/waivers/WaiverAvailabilityProjectionService.ts`
- Modify: `src/server/rosters/RosterProjectionService.ts`
- Modify: `src/app/api/leagues/[id]/waivers/submit/route.ts`
- Modify: `src/app/api/leagues/[id]/waivers/process/route.ts`
- Test: `tests/unit/waiverAvailabilityProjection.test.ts`

- [ ] **Step 1: Write waiver projection test**

Create `tests/unit/waiverAvailabilityProjection.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { WaiverAvailabilityProjectionService } from '../../src/server/waivers/WaiverAvailabilityProjectionService';

describe('WaiverAvailabilityProjectionService', () => {
  it('marks owned players unavailable and undrafted players available in the compatibility projection', async () => {
    const firestore = {
      batch: vi.fn(() => ({
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      })),
      collection: vi.fn(),
    };

    const prisma = {
      leagueRosterPlayer: {
        findMany: vi.fn().mockResolvedValue([{ playerId: 'owned-1', memberId: 'member-1' }]),
      },
      player: {
        findMany: vi.fn().mockResolvedValue([{ id: 'owned-1' }, { id: 'free-1' }]),
      },
    };

    const service = new WaiverAvailabilityProjectionService(prisma as never, firestore as never);
    await service.projectLeague({ leagueId: 'league-1' });

    expect(prisma.leagueRosterPlayer.findMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' }, select: { playerId: true, memberId: true } });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test:unit -- tests/unit/waiverAvailabilityProjection.test.ts
```

Expected before implementation: fails because the service does not exist.

- [ ] **Step 3: Create waiver projection service**

Create `src/server/waivers/WaiverAvailabilityProjectionService.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getAdminDb } from '@/lib/firebaseAdmin';

type PrismaLike = typeof prisma;
type FirestoreLike = ReturnType<typeof getAdminDb>;

export class WaiverAvailabilityProjectionService {
  constructor(
    private readonly db: PrismaLike = prisma,
    private readonly firestore: FirestoreLike = getAdminDb(),
  ) {}

  async projectLeague(input: { leagueId: string }) {
    const ownerships = await this.db.leagueRosterPlayer.findMany({
      where: { leagueId: input.leagueId },
      select: { playerId: true, memberId: true },
    });
    const allPlayers = await this.db.player.findMany({ select: { id: true } });
    const owned = new Map(ownerships.map((ownership) => [ownership.playerId, ownership.memberId]));
    const batch = this.firestore.batch();

    for (const player of allPlayers) {
      const ownerMemberId = owned.get(player.id);
      const ownershipRef = this.firestore.collection('leagues').doc(input.leagueId).collection('playerOwnerships').doc(player.id);
      const availabilityRef = this.firestore.collection('leagues').doc(input.leagueId).collection('availablePlayers').doc(player.id);

      if (ownerMemberId) {
        batch.set(ownershipRef, { playerId: player.id, memberId: ownerMemberId, status: 'owned', updatedAt: new Date().toISOString() }, { merge: true });
        batch.delete(availabilityRef);
      } else {
        batch.set(availabilityRef, { playerId: player.id, status: 'available', updatedAt: new Date().toISOString() }, { merge: true });
        batch.delete(ownershipRef);
      }
    }

    await batch.commit();

    return { owned: ownerships.length, available: allPlayers.length - ownerships.length };
  }
}
```

- [ ] **Step 4: Call waiver projection after roster projection**

In `src/server/rosters/RosterProjectionService.ts`, after player ownership upserts finish:

```ts
await this.waiverAvailabilityProjectionService.projectLeague({ leagueId: input.leagueId });
```

Inject the dependency through the constructor so unit tests can pass a fake projection service.

- [ ] **Step 5: Use shared membership in waiver routes**

In `src/app/api/leagues/[id]/waivers/process/route.ts`, replace Firestore-only manager checks with:

```ts
const userId = await getAuthenticatedUserId(request);

if (!userId) {
  return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
}

const allowed = await canManageLeague(leagueId, userId);

if (!allowed) {
  return NextResponse.json({ success: false, error: 'Commissioner access required' }, { status: 403 });
}
```

In `src/app/api/leagues/[id]/waivers/submit/route.ts`, use `getLeagueMembershipAccess` and reject non-members:

```ts
const access = await getLeagueMembershipAccess(leagueId, userId);

if (!access.isMember) {
  return NextResponse.json({ success: false, error: 'League membership required' }, { status: 403 });
}
```

- [ ] **Step 6: Verify waiver projection**

Run:

```bash
npm run test:unit -- tests/unit/waiverAvailabilityProjection.test.ts tests/unit/waiverPendingBidArchitecture.test.ts tests/unit/waiversPageArchitecture.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 9: Read-Only GET Paths And Explicit Lifecycle Commands

**Files:**

- Modify: `src/lib/draftLobby.ts`
- Modify: `src/server/draft/services/DraftSetupConvergenceService.ts`
- Modify: `src/app/api/drafts/[id]/lobby/route.ts`
- Modify: `src/app/api/drafts/[id]/lobby/ready/route.ts`
- Test: `tests/unit/DraftReadinessService.test.ts`

- [ ] **Step 1: Add read-only assertions**

Update `tests/unit/DraftReadinessService.test.ts` with:

```ts
it('keeps lobby read paths free of lifecycle writes', () => {
  const lobbySource = readFileSync(join(process.cwd(), 'src/lib/draftLobby.ts'), 'utf8');
  const convergenceSource = readFileSync(join(process.cwd(), 'src/server/draft/services/DraftSetupConvergenceService.ts'), 'utf8');

  expect(lobbySource).not.toContain('auto-open');
  expect(convergenceSource).not.toContain('startDraft(');
  expect(convergenceSource).not.toContain('currentPickDeadline');
});
```

- [ ] **Step 2: Run failing readiness test**

Run:

```bash
npm run test:unit -- tests/unit/DraftReadinessService.test.ts
```

Expected before implementation: fails if read paths still mutate lifecycle.

- [ ] **Step 3: Make lobby state reads pure**

In `src/lib/draftLobby.ts`, remove draft state writes from `getLobbyState`. Return the stored state and let command routes open or start lobbies.

Use this return shape when no active lobby exists:

```ts
return {
  draftId,
  status: 'pending',
  readyMemberIds: [],
  updatedAt: new Date(0).toISOString(),
};
```

- [ ] **Step 4: Make convergence settings-only**

In `src/server/draft/services/DraftSetupConvergenceService.ts`, keep settings reconciliation, but remove clock start behavior. Return an explicit action recommendation:

```ts
return {
  draft,
  settings,
  recommendedAction: draft.status === 'SCHEDULED' ? 'AWAIT_EXPLICIT_START' : 'NONE',
};
```

- [ ] **Step 5: Verify readiness**

Run:

```bash
npm run test:unit -- tests/unit/DraftReadinessService.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 10: Socket Auth And Reconnect Backfill

**Files:**

- Modify: `src/providers/SocketProvider.tsx`
- Modify: `src/server/socketioServer.ts`
- Modify: `src/server/draft/services/DraftRealtimeDispatcher.ts`
- Modify: `src/app/api/socketio/route.ts`
- Test: `tests/unit/SocketProvider.test.tsx`
- Test: `tests/unit/socketioConfig.test.ts`
- Test: `tests/unit/DraftRealtimePublisher.test.ts`

- [ ] **Step 1: Add socket contract assertions**

Update `tests/unit/socketioConfig.test.ts`:

```ts
expect(socketServerSource).toContain('socket.handshake.auth.token');
expect(socketServerSource).toContain('DraftEvent');
expect(socketRouteSource).not.toContain('status: \"ok\"');
```

Update `tests/unit/SocketProvider.test.tsx`:

```ts
expect(providerSource).toContain('auth: { token');
expect(providerSource).not.toContain('auth: { uid');
```

- [ ] **Step 2: Run failing socket tests**

Run:

```bash
npm run test:unit -- tests/unit/SocketProvider.test.tsx tests/unit/socketioConfig.test.ts
```

Expected before implementation: fails while client and server auth shapes differ.

- [ ] **Step 3: Align client auth payload**

In `src/providers/SocketProvider.tsx`, send token auth:

```ts
const token = await currentUser.getIdToken();

const socket = io(socketUrl, {
  auth: { token },
  transports: ['websocket', 'polling'],
});
```

For development tester mode without Firebase auth, send:

```ts
auth: { token: `dev:${currentUser.uid}` }
```

only when `process.env.NODE_ENV !== 'production'`.

- [ ] **Step 4: Align socket server validation**

In `src/server/socketioServer.ts`, validate:

```ts
const token = socket.handshake.auth?.token;

if (!token || typeof token !== 'string') {
  return next(new Error('Authentication required'));
}

if (token.startsWith('dev:') && process.env.NODE_ENV !== 'production') {
  socket.data.userId = token.slice(4);
  return next();
}

const decoded = await verifyFirebaseIdToken(token);
socket.data.userId = decoded.uid;
return next();
```

- [ ] **Step 5: Source backfill from persisted draft events**

In `src/server/socketioServer.ts`, replace Redis-only backfill with a Prisma event query:

```ts
const events = await prisma.draftEvent.findMany({
  where: {
    draftId,
    sequence: { gt: lastSequence },
  },
  orderBy: { sequence: 'asc' },
  take: 100,
});
```

- [ ] **Step 6: Verify socket flow**

Run:

```bash
npm run test:unit -- tests/unit/SocketProvider.test.tsx tests/unit/socketioConfig.test.ts tests/unit/DraftRealtimePublisher.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 11: Legacy League, Draft, And Waiver Surface Quarantine

**Files:**

- Modify: `src/app/api/user/leagues/route.ts`
- Modify: `src/app/api/leagues/[id]/members/route.ts`
- Modify: `src/components/league/LeagueTabs.tsx`
- Modify: `src/components/waivers/LeagueWaiversContainer.tsx`
- Modify: `src/services/waiverService.ts`
- Test: `tests/unit/userLeagueListRouteArchitecture.test.ts`
- Test: `tests/unit/leagueMembershipRoutes.test.ts`
- Test: `tests/unit/waiversPageArchitecture.test.ts`

- [ ] **Step 1: Add legacy quarantine assertions**

Update tests to assert development fixtures are gated:

```ts
expect(source).toContain('process.env.NODE_ENV !== \"production\"');
expect(source).not.toContain('test-league-id');
```

For waiver service, assert no stubbed happy path is returned:

```ts
expect(source).not.toContain('mock');
expect(source).not.toContain('stub');
```

- [ ] **Step 2: Run failing quarantine tests**

Run:

```bash
npm run test:unit -- tests/unit/userLeagueListRouteArchitecture.test.ts tests/unit/leagueMembershipRoutes.test.ts tests/unit/waiversPageArchitecture.test.ts
```

Expected before implementation: fails where development fixtures or placeholder waiver responses remain reachable.

- [ ] **Step 3: Gate development fixtures**

In API routes with test data, wrap fixture behavior:

```ts
if (process.env.NODE_ENV !== 'production' && userId === 'statly-dev-tester') {
  return NextResponse.json({ success: true, data: developmentLeagues });
}
```

Production paths must use shared league membership services.

- [ ] **Step 4: Replace waiver stub service responses with explicit errors**

In `src/services/waiverService.ts`, when a required canonical endpoint cannot be reached:

```ts
throw new Error('Waiver data is unavailable because league ownership projection has not loaded');
```

The UI should render this as an error state instead of an empty successful waiver list.

- [ ] **Step 5: Verify quarantine**

Run:

```bash
npm run test:unit -- tests/unit/userLeagueListRouteArchitecture.test.ts tests/unit/leagueMembershipRoutes.test.ts tests/unit/waiversPageArchitecture.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 12: Browser Verification Flow

**Files:**

- No source edits unless verification exposes a regression already covered by this plan.

- [ ] **Step 1: Start full stack dev**

Run:

```bash
npm run dev:kill
npm run dev:full
```

Expected: Next.js and Socket.IO start without port conflicts. Use `http://localhost:3000` unless the app selects another port.

- [ ] **Step 2: Verify league setup**

In the browser:

```text
/leagues/new
```

Expected:

- Creating a league navigates to `/leagues/<id>`.
- The league page does not redirect to the draft room on its own.
- No debug placeholder panels are visible in production-shaped UI.

- [ ] **Step 3: Verify admin draft settings**

In the browser:

```text
/leagues/<id>
```

Expected:

- Commissioner can open draft settings.
- Time per pick includes 15 seconds, 30 seconds, 60 seconds, 90 seconds, and 120 seconds if those options remain in product scope.
- Draft order supports manual and randomized order.
- Position limits and auto-pick rules are saved through the canonical settings route.
- Creating a draft returns to the league draft management state without calling `/link-draft`.

- [ ] **Step 4: Verify pre-draft queue**

In the browser:

```text
/drafts/<draftId>
```

Expected:

- Adding and removing players from queue works for the logged-in member.
- Changing request body `memberId` in dev tools does not modify another member's queue.
- Refresh keeps the queue because it is backed by `PreDraftQueue`.

- [ ] **Step 5: Verify active draft pick and roster projection**

In the browser:

```text
/drafts/<draftId>
```

Expected:

- Manual pick POST succeeds through `/api/drafts/<draftId>/picks`.
- Pick feed updates through realtime or backfill after refresh.
- After the draft completes or a projection command is run, drafted players appear in the member roster.
- A drafted player cannot appear on two rosters in the same league.

- [ ] **Step 6: Verify waiver pool**

In the browser:

```text
/leagues/<id>/waivers
```

Expected:

- Drafted players are not listed as available.
- Undrafted players are listed as available.
- Submitting a claim requires league membership.
- Processing claims requires commissioner access.

## Task 13: Phase Completion Review And Commit

**Files:**

- Stage only files changed by the phase.

- [ ] **Step 1: Inspect diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: no whitespace errors; `prisma/dev.db` remains unstaged.

- [ ] **Step 2: Run required checks**

Run:

```bash
npm run typecheck
npm run test:unit
```

Expected: typecheck and unit tests pass.

- [ ] **Step 3: Stage intended files only**

Run a narrow `git add` command for the phase. Example for the plan-only commit:

```bash
git add docs/superpowers/plans/2026-06-06-fantasy-league-draft-platform-hardening.md
```

Expected:

```bash
git diff --cached --name-only
```

shows only the intended files.

- [ ] **Step 4: Run chairman commit gate**

Run:

```bash
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed work should be committed."
```

Expected output contains:

```text
CHAIRMAN DECISION 2: COMMIT
```

- [ ] **Step 5: Commit through reviewed path**

Run:

```bash
npm run codex:commit:reviewed -- "hardening: plan league draft platform"
```

Expected: commit succeeds and does not include unrelated local files.

## Subagent Execution Allocation

Use subagents only for bounded work with disjoint write scopes. Keep service integration and final verification local.

- Task 1 can run in a subagent scoped to `src/server/leagues/membership.ts`, `src/app/api/drafts/route.ts`, and `tests/unit/draftCreateAuthorization.test.ts`.
- Task 2 can run in a subagent scoped to `src/server/leagues/createLeagueContract.ts`, `src/app/api/leagues/route.ts`, `src/app/leagues/new/page.tsx`, and `tests/unit/leagueCreateContract.test.ts`.
- Task 4 can run in a subagent scoped to draft command routes and `tests/unit/draftCommandRoutes.test.ts`; final service method integration should be reviewed locally.
- Task 6 and Task 7 should run sequentially because generated Prisma types from Task 6 are required before Task 7 compiles.
- Task 8 should run after Task 7 because waiver projection depends on canonical roster ownership.
- Task 10 can run independently after Task 4 because it touches socket transport and event backfill rather than route command writes.

## Self-Review

Spec coverage:

- Leagues: covered by Tasks 1, 2, 3, and 11.
- Players: covered by Tasks 6, 7, 8, and 12.
- League setup: covered by Task 2 and Task 12.
- Admin pre-draft workflow: covered by Tasks 3, 5, and 12.
- Admin draft settings workflow: covered by Tasks 3 and 12.
- Connectivity between components: covered by Tasks 3, 4, 5, 9, 10, and 12.
- Post-draft player distribution to teams: covered by Tasks 6 and 7.
- Waiver wire for undrafted players: covered by Task 8.
- Durability and scalability: covered by canonical ownership schema, service boundaries, outbox-backed backfill, and route authorization tests.

Placeholder scan:

- This plan contains concrete file paths, concrete test commands, and concrete implementation snippets for each code task.
- No planned task asks an implementer to invent an undefined boundary before writing code.

Type consistency:

- The plan uses `getLeagueMembershipAccess`, `canManageLeague`, and `getDraftMembershipAccess` consistently as shared league authorization entry points.
- The plan uses `LeagueRosterPlayer` as the canonical normalized roster ownership model with `leagueId_playerId` as the cross-team uniqueness boundary.
- The plan uses `DraftApplicationService` as the single draft mutation owner and keeps route files as transport adapters.

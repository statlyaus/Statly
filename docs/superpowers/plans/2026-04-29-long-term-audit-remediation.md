# Statly Long-Term Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 2026-04-29 full-code audit findings into a durable, secure, and converged Statly architecture that is safe to release and easier to verify.

**Architecture:** Fix release-blocking security and artifact hygiene first, then restore the deterministic test/release gate, then complete Footywire convergence around the canonical Firestore raw-match contract. Operational mutation moves behind shared authorization helpers, public reads stop mutating data, imports publish bounded dependent projections, and verification fails on the exact drift classes the repository treats as architectural failures.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Firebase Admin/Auth/Firestore, Prisma, Vitest, ESLint, Prettier, npm scripts, shadcn-style UI conventions.

---

## Scope Check

The audit covers four independent subsystems: security/operations, release tooling, Footywire data convergence, and frontend/accessibility. This plan intentionally keeps them as separate task groups with separate commits. Execute them in order through Task 10 before broad UI/design cleanup, because P0 security and red release gates should not wait behind cosmetic work.

## Source Documents

- `docs/audits/2026-04-29-full-code-audit.md`
- `docs/audits/2026-04-29-full-code-audit-evidence.md`
- `AGENTS.md`
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- `docs/DATA_RELIABILITY.md`
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- `docs/runtime-contract.md`

## File Structure

- `src/lib/operationalAuth.ts`: new shared route authorization helper for admin, cron, ETL, and local-only development gates.
- `src/lib/operationalAuth.test.ts`: unit tests for the authorization helper.
- `src/app/api/admin/workers/route.ts`: apply admin authorization to worker status and mutation operations.
- `src/app/api/admin/workers/route.test.ts`: route tests for unauthenticated and authorized worker access.
- `src/app/api/admin/queue/route.ts`: apply admin authorization to queue status and mutation operations.
- `src/app/api/admin/queue/route.test.ts`: route tests for unauthenticated and authorized queue access.
- `src/app/api/cron/live-stats/route.ts`: replace fail-open cron logic with shared operational authorization.
- `src/app/api/cron/live-stats/route.test.ts`: cron auth tests.
- `src/app/api/cron/reminders/route.ts`: replace fail-open cron logic with shared operational authorization.
- `src/app/api/cron/reminders/route.test.ts`: cron auth tests.
- `src/app/api/admin/draft-repair/route.ts`: replace fail-open admin repair logic with shared operational authorization.
- `src/app/api/admin/draft-repair/route.test.ts`: admin repair auth tests.
- `src/lib/liveStatsRefresh.ts`: keep mutation behavior here, but make it callable only from authorized routes.
- Public read routes currently calling `refreshLiveStatsIfNeeded`: remove mutation calls and return current projections.
- `.gitignore`: ignore production env files and local generated data.
- `Scripts/check-tracked-local-artifacts.mjs`: guard pglite and production env artifacts.
- `scripts/scan-secrets.ts`: scan tracked env files and deployable standalone output without dependency false positives.
- `.github/workflows/*.yml`: ensure guards run before upload of deploy artifacts.
- `src/app/api/players/search/route.ts`: explicit StatsReadService fallback behavior.
- `src/app/api/players/search/route.test.ts`: align tests with the StatsReadService contract.
- `src/components/__tests__/AuthForm.test.tsx`: deterministic valid-submit test.
- `Scripts/build-player-read-models.ts`: safe `--help` before live imports.
- `Scripts/verify-player-read-models.ts`: safe `--help` before live imports.
- `Scripts/verify-player-read-models-core.ts`: strict dropped-row status and reusable help text.
- `src/app/api/etl/import-rounds/route.ts`: verifier command includes merged live comparison and import publishes/enqueues dependent projections.
- `src/server/readModels/playerReadModels.ts`: expose bounded publication helpers where needed and persist provenance in projections.
- `src/lib/stats/footywireCanonicalContract.ts`: centralize source-priority vocabulary and source-name normalization.
- `src/lib/footywireStatsIngestion.ts`: consume canonical source priority instead of local ranking.
- `etl/processFootywireData.ts`: consume canonical source priority instead of local ranking.
- Prisma schema/migrations: add projection provenance if the existing schema lacks a storage field.
- `src/components/draft/DraftContainer.tsx`: remove production debug and force-entry controls.
- `src/components/layout/MainNavigation.tsx`: fix disclosure/menu accessibility semantics.
- `src/components/draft/PlayerGrid.tsx`: replace pseudo-table roles with semantic list/grid behavior and real virtualization if needed.
- `src/components/league/LeagueTabs.tsx`: split large client component into focused client islands after release blockers are fixed.

## Execution Rules

- Run this in a dedicated worktree.
- Keep each task as one commit.
- Do not mix formatting-only changes with semantic fixes.
- When touching Footywire canonical semantics, update writer, reader, verifier, and tests in the same task.
- If a task reveals a different root cause, stop and update this plan before editing more code.

### Task 1: Create Dedicated Remediation Worktree

**Files:**
- No file edits.

- [ ] **Step 1: Confirm the current repository state**

Run:

```bash
git status --short
git branch --show-current
```

Expected: current dirty worktree is visible and branch name prints.

- [ ] **Step 2: Create a dedicated worktree**

Run:

```bash
git worktree add ../Statly-audit-remediation -b codex/audit-remediation
cd ../Statly-audit-remediation
```

Expected: a new worktree exists at `/Users/robert/Developer/Statly-audit-remediation` on branch `codex/audit-remediation`.

- [ ] **Step 3: Install dependencies if needed**

Run:

```bash
npm install
```

Expected: dependencies install without lockfile churn beyond the current repository state.

- [ ] **Step 4: Run baseline checks**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run guard:secrets
npm run format:check
```

Expected: typecheck and lint pass; test, secret guard, and format check reproduce the audit failures.

### Task 2: Add Shared Operational Authorization Helper

**Files:**
- Create: `src/lib/operationalAuth.ts`
- Create: `src/lib/operationalAuth.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/operationalAuth.test.ts` with:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeAdminRequest,
  authorizeCronRequest,
  authorizeLocalOnlyRequest,
} from './operationalAuth';

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe('operational authorization', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('rejects admin requests without ADMIN_API_TOKEN in shared environments', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', '');

    const result = authorizeAdminRequest(request('http://localhost/api/admin/workers'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('accepts admin bearer token when it matches ADMIN_API_TOKEN', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');

    const result = authorizeAdminRequest(
      request('http://localhost/api/admin/workers', {
        authorization: 'Bearer admin-secret',
      })
    );

    expect(result.ok).toBe(true);
  });

  it('accepts x-admin-token when it matches ADMIN_API_TOKEN', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');

    const result = authorizeAdminRequest(
      request('http://localhost/api/admin/queue', {
        'x-admin-token': 'admin-secret',
      })
    );

    expect(result.ok).toBe(true);
  });

  it('allows local-only requests only for explicit local runtime', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'local');
    expect(authorizeLocalOnlyRequest(request('http://localhost/api/dev/test-user')).ok).toBe(
      true
    );

    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    const result = authorizeLocalOnlyRequest(request('http://localhost/api/dev/test-user'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it('requires CRON_SECRET for cron requests outside explicit local runtime', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('CRON_SECRET', '');

    const result = authorizeCronRequest(request('http://localhost/api/cron/live-stats'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('accepts cron bearer token when it matches CRON_SECRET', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const result = authorizeCronRequest(
      request('http://localhost/api/cron/live-stats', {
        authorization: 'Bearer cron-secret',
      })
    );

    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
npx vitest run src/lib/operationalAuth.test.ts
```

Expected: FAIL because `src/lib/operationalAuth.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/operationalAuth.ts` with:

```ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

type AuthorizationSuccess = { ok: true };
type AuthorizationFailure = { ok: false; response: NextResponse };
export type AuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

function configuredRuntimeEnv() {
  return process.env.STATLY_RUNTIME_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || 'local';
}

export function isExplicitLocalRuntime() {
  const runtimeEnv = configuredRuntimeEnv();
  return runtimeEnv === 'local' || runtimeEnv === 'development';
}

function tokenFromRequest(request: NextRequest, headerName: string) {
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) return bearer.slice('Bearer '.length);
  return request.headers.get(headerName);
}

function unauthorized(message = 'Unauthorized'): AuthorizationFailure {
  return {
    ok: false,
    response: NextResponse.json({ success: false, error: message }, { status: 401 }),
  };
}

export function notFound(): AuthorizationFailure {
  return {
    ok: false,
    response: NextResponse.json({ success: false, error: 'Not found' }, { status: 404 }),
  };
}

export function authorizeTokenRequest(
  request: NextRequest,
  options: {
    secret: string | undefined;
    headerName: string;
    allowLocalWithoutSecret: boolean;
    missingSecretMessage: string;
  }
): AuthorizationResult {
  const secret = options.secret?.trim();
  if (!secret) {
    return options.allowLocalWithoutSecret && isExplicitLocalRuntime()
      ? { ok: true }
      : unauthorized(options.missingSecretMessage);
  }

  const suppliedToken = tokenFromRequest(request, options.headerName);
  return suppliedToken === secret ? { ok: true } : unauthorized();
}

export function authorizeAdminRequest(request: NextRequest): AuthorizationResult {
  return authorizeTokenRequest(request, {
    secret: process.env.ADMIN_API_TOKEN,
    headerName: 'x-admin-token',
    allowLocalWithoutSecret: true,
    missingSecretMessage: 'Admin token is not configured',
  });
}

export function authorizeCronRequest(request: NextRequest): AuthorizationResult {
  return authorizeTokenRequest(request, {
    secret: process.env.CRON_SECRET,
    headerName: 'x-cron-token',
    allowLocalWithoutSecret: true,
    missingSecretMessage: 'Cron token is not configured',
  });
}

export function authorizeLocalOnlyRequest(_request: NextRequest): AuthorizationResult {
  return isExplicitLocalRuntime() ? { ok: true } : notFound();
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run:

```bash
npx vitest run src/lib/operationalAuth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/operationalAuth.ts src/lib/operationalAuth.test.ts
git commit -m "feat: add shared operational route authorization"
```

Expected: commit succeeds.

### Task 3: Protect Admin Worker and Queue APIs

**Files:**
- Modify: `src/app/api/admin/workers/route.ts`
- Create: `src/app/api/admin/workers/route.test.ts`
- Modify: `src/app/api/admin/queue/route.ts`
- Create: `src/app/api/admin/queue/route.test.ts`

- [ ] **Step 1: Add worker route tests**

Create `src/app/api/admin/workers/route.test.ts` with:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolStatsMock = vi.fn();
const checkHealthMock = vi.fn();
const startMock = vi.fn();

vi.mock('@/server/workers/workerPool', () => ({
  workerPool: {
    getPoolStats: getPoolStatsMock,
    checkHealth: checkHealthMock,
    start: startMock,
    stop: vi.fn(),
    addWorker: vi.fn(),
    removeWorker: vi.fn(),
  },
}));

describe('/api/admin/workers authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');
    getPoolStatsMock.mockReturnValue({ workers: 1 });
    checkHealthMock.mockResolvedValue({ healthy: true });
    startMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated worker status requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/admin/workers'));

    expect(response.status).toBe(401);
    expect(getPoolStatsMock).not.toHaveBeenCalled();
  });

  it('allows authenticated worker status requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/workers?action=stats', {
        headers: { authorization: 'Bearer admin-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(getPoolStatsMock).toHaveBeenCalled();
  });

  it('rejects unauthenticated worker mutation requests', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/workers', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      })
    );

    expect(response.status).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add queue route tests**

Create `src/app/api/admin/queue/route.test.ts` with:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWaitingMock = vi.fn();
const getActiveMock = vi.fn();
const getCompletedMock = vi.fn();
const getFailedMock = vi.fn();
const getDelayedMock = vi.fn();

vi.mock('@/server/queue/draftQueue', () => ({
  draftQueue: {
    getWaiting: getWaitingMock,
    getActive: getActiveMock,
    getCompleted: getCompletedMock,
    getFailed: getFailedMock,
    getDelayed: getDelayedMock,
  },
}));

describe('/api/admin/queue authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');
    getWaitingMock.mockResolvedValue([]);
    getActiveMock.mockResolvedValue([]);
    getCompletedMock.mockResolvedValue([]);
    getFailedMock.mockResolvedValue([]);
    getDelayedMock.mockResolvedValue([]);
  });

  it('rejects unauthenticated queue requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/admin/queue?action=stats'));

    expect(response.status).toBe(401);
    expect(getWaitingMock).not.toHaveBeenCalled();
  });

  it('allows authenticated queue requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/queue?action=stats', {
        headers: { 'x-admin-token': 'admin-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(getWaitingMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run route tests to verify failure**

Run:

```bash
npx vitest run src/app/api/admin/workers/route.test.ts src/app/api/admin/queue/route.test.ts
```

Expected: FAIL because routes do not call `authorizeAdminRequest`.

- [ ] **Step 4: Apply admin authorization to worker route**

In `src/app/api/admin/workers/route.ts`, add:

```ts
import { authorizeAdminRequest } from '@/lib/operationalAuth';
```

At the top of `GET` and `POST`, before any worker pool access, add:

```ts
  const authorization = authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
```

- [ ] **Step 5: Apply admin authorization to queue route**

In `src/app/api/admin/queue/route.ts`, add:

```ts
import { authorizeAdminRequest } from '@/lib/operationalAuth';
```

At the top of `GET`, before any queue access, add:

```ts
  const authorization = authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
```

- [ ] **Step 6: Run route tests to verify pass**

Run:

```bash
npx vitest run src/app/api/admin/workers/route.test.ts src/app/api/admin/queue/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run route guard and typecheck**

Run:

```bash
npm run guard:routes
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/app/api/admin/workers/route.ts src/app/api/admin/workers/route.test.ts src/app/api/admin/queue/route.ts src/app/api/admin/queue/route.test.ts
git commit -m "fix: require authorization for admin worker and queue APIs"
```

Expected: commit succeeds.

### Task 4: Remove Fail-Open Cron and Repair Authorization

**Files:**
- Modify: `src/app/api/cron/live-stats/route.ts`
- Create: `src/app/api/cron/live-stats/route.test.ts`
- Modify: `src/app/api/cron/reminders/route.ts`
- Create: `src/app/api/cron/reminders/route.test.ts`
- Modify: `src/app/api/admin/draft-repair/route.ts`
- Create or modify: `src/app/api/admin/draft-repair/route.test.ts`

- [ ] **Step 1: Add live-stats cron authorization tests**

Create `src/app/api/cron/live-stats/route.test.ts` with:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshLiveStatsIfNeededMock = vi.fn();

vi.mock('@/lib/liveStatsRefresh', () => ({
  refreshLiveStatsIfNeeded: refreshLiveStatsIfNeededMock,
}));

describe('/api/cron/live-stats authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    refreshLiveStatsIfNeededMock.mockResolvedValue({ refreshed: true });
  });

  it('rejects requests without a cron token', async () => {
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/cron/live-stats'));

    expect(response.status).toBe(401);
    expect(refreshLiveStatsIfNeededMock).not.toHaveBeenCalled();
  });

  it('runs live refresh when the cron token is valid', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/cron/live-stats', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(refreshLiveStatsIfNeededMock).toHaveBeenCalledWith({
      minIntervalMs: 30_000,
      trigger: 'cron',
    });
  });

  it('rejects missing CRON_SECRET in preview', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/cron/live-stats'));

    expect(response.status).toBe(401);
    expect(refreshLiveStatsIfNeededMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add equivalent tests for reminders and draft repair**

Use the same authorization assertions for:

```bash
src/app/api/cron/reminders/route.test.ts
src/app/api/admin/draft-repair/route.test.ts
```

The reminders test must assert that the reminder job does not run when authorization fails. The draft-repair test must assert that repair work does not run when authorization fails and does run with `authorization: Bearer admin-secret`.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run src/app/api/cron/live-stats/route.test.ts src/app/api/cron/reminders/route.test.ts src/app/api/admin/draft-repair/route.test.ts
```

Expected: FAIL for routes that still allow missing secrets in preview/test shared mode.

- [ ] **Step 4: Use shared auth in cron routes**

In both cron routes, import:

```ts
import { authorizeCronRequest } from '@/lib/operationalAuth';
```

At the start of each handler, add:

```ts
  const authorization = authorizeCronRequest(request);
  if (!authorization.ok) return authorization.response;
```

Remove local logic that treats a missing secret as authorized outside explicit local runtime.

- [ ] **Step 5: Use shared admin auth in draft repair**

In `src/app/api/admin/draft-repair/route.ts`, import:

```ts
import { authorizeAdminRequest } from '@/lib/operationalAuth';
```

At the start of each mutation handler, add:

```ts
  const authorization = authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
```

- [ ] **Step 6: Run authorization tests**

Run:

```bash
npx vitest run src/app/api/cron/live-stats/route.test.ts src/app/api/cron/reminders/route.test.ts src/app/api/admin/draft-repair/route.test.ts src/lib/operationalAuth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/lib/operationalAuth.ts src/app/api/cron/live-stats/route.ts src/app/api/cron/live-stats/route.test.ts src/app/api/cron/reminders/route.ts src/app/api/cron/reminders/route.test.ts src/app/api/admin/draft-repair/route.ts src/app/api/admin/draft-repair/route.test.ts
git commit -m "fix: remove fail-open operational auth paths"
```

Expected: commit succeeds.

### Task 5: Move Live Refresh Out of Public Read Endpoints

**Files:**
- Modify: `src/app/api/live-player-stats/route.ts`
- Modify: `src/app/api/etl/live-player-stats/route.ts`
- Modify: `src/app/api/etl/live-matches/route.ts`
- Modify every public league route found by `rg -n "refreshLiveStatsIfNeeded" src/app/api src/lib`
- Test: existing route tests or new tests beside changed routes

- [ ] **Step 1: Inventory current mutation callers**

Run:

```bash
rg -n "refreshLiveStatsIfNeeded" src/app/api src/lib
```

Expected: public read endpoints and authorized cron/admin paths are listed.

- [ ] **Step 2: Add a public-read regression test**

For each public route that currently refreshes live stats, add a route test with this assertion shape:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshLiveStatsIfNeededMock = vi.fn();

vi.mock('@/lib/liveStatsRefresh', () => ({
  refreshLiveStatsIfNeeded: refreshLiveStatsIfNeededMock,
}));

describe('public live stats read route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not run live refresh during a public read', async () => {
    const { GET } = await import('./route');
    await GET(new NextRequest('http://localhost/api/live-player-stats'));

    expect(refreshLiveStatsIfNeededMock).not.toHaveBeenCalled();
  });
});
```

Adjust the URL and import path to the route being tested. Mock the route's read dependencies so the test exercises only the no-mutation invariant.

- [ ] **Step 3: Run public-read tests to verify failure**

Run the new focused tests:

```bash
npx vitest run src/app/api/live-player-stats/route.test.ts src/app/api/etl/live-player-stats/route.test.ts src/app/api/etl/live-matches/route.test.ts
```

Expected: FAIL for routes that still call `refreshLiveStatsIfNeeded`.

- [ ] **Step 4: Remove refresh calls from public reads**

In each public read route, remove:

```ts
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';
```

Remove call blocks shaped like:

```ts
await refreshLiveStatsIfNeeded({
  minIntervalMs: 30_000,
  trigger: 'public_read',
});
```

Keep the route returning current persisted projections or cached data.

- [ ] **Step 5: Confirm only authorized routes mutate live stats**

Run:

```bash
rg -n "refreshLiveStatsIfNeeded" src/app/api src/lib
```

Expected: matches remain only in `src/lib/liveStatsRefresh.ts` and authorized cron/admin/ETL mutation paths.

- [ ] **Step 6: Run focused route tests**

Run:

```bash
npx vitest run src/app/api/live-player-stats/route.test.ts src/app/api/etl/live-player-stats/route.test.ts src/app/api/etl/live-matches/route.test.ts src/app/api/cron/live-stats/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/app/api src/lib/liveStatsRefresh.ts
git commit -m "fix: keep public live stat reads side-effect free"
```

Expected: commit succeeds.

### Task 6: Remove Tracked Secrets and Generated Local Artifacts

**Files:**
- Modify: `.gitignore`
- Modify: `Scripts/check-tracked-local-artifacts.mjs`
- Modify: `scripts/scan-secrets.ts`
- Remove from index: `.env.production`
- Remove from index: `dataconnect/.dataconnect/pgliteData/**`

- [ ] **Step 1: Add guard expectations before cleanup**

Run:

```bash
git ls-files .env.production
git ls-files dataconnect/.dataconnect/pgliteData | sed -n '1,20p'
npm run guard:tracked-artifacts
npm run guard:secrets
```

Expected: `.env.production` and pglite internals are tracked; artifact guard currently misses pglite; secret guard fails.

- [ ] **Step 2: Extend `.gitignore`**

Add these lines to `.gitignore`:

```gitignore
.env.production
.env.*.local
dataconnect/.dataconnect/pgliteData/
.next/
```

- [ ] **Step 3: Extend tracked-artifact guard**

In `Scripts/check-tracked-local-artifacts.mjs`, include these patterns in the guarded path list:

```js
const forbiddenTrackedPatterns = [
  '.env.production',
  'dataconnect/.dataconnect/pgliteData/**',
  '.firebase/**',
  'firebase-export-*/**',
  'prisma/*.db',
  'tmp-*.png',
];
```

If the script uses a different variable name, keep the existing structure and add the two new patterns exactly.

- [ ] **Step 4: Remove generated and secret files from the git index**

Run:

```bash
git rm --cached .env.production
git rm -r --cached dataconnect/.dataconnect/pgliteData
```

Expected: files are removed from version control but remain in the working tree if present locally.

- [ ] **Step 5: Update secret scanner to fail on tracked env files**

In `scripts/scan-secrets.ts`, make sure the scanned path list includes tracked env files and deployable standalone env files:

```ts
const requiredScanGlobs = [
  '.env*',
  '.next/standalone/.env*',
  'src/**/*.{ts,tsx,js,jsx}',
  'Scripts/**/*.{ts,tsx,js,cjs,mjs}',
  'scripts/**/*.{ts,tsx,js,cjs,mjs}',
];
```

Keep dependency directories excluded:

```ts
const ignoredPathFragments = [
  'node_modules/',
  '.next/standalone/node_modules/',
  '.next/server/chunks/',
  '.git/',
];
```

The scanner must fail on repository-owned env files and must not fail on dependency source files that contain private-key parser strings.

- [ ] **Step 6: Run guards**

Run:

```bash
git ls-files .env.production
git ls-files dataconnect/.dataconnect/pgliteData
npm run guard:tracked-artifacts
npm run guard:secrets
```

Expected: both `git ls-files` commands print nothing; both guards pass.

- [ ] **Step 7: Document required credential rotation**

Add this section to `docs/audits/2026-04-29-full-code-audit.md` under the P0 secret finding:

```markdown
Remediation note: credentials represented by tracked `.env.production` must be rotated outside git. Removing the file from tracking prevents future exposure but does not invalidate values already present in repository history or local clones.
```

- [ ] **Step 8: Commit**

Run:

```bash
git add .gitignore Scripts/check-tracked-local-artifacts.mjs scripts/scan-secrets.ts docs/audits/2026-04-29-full-code-audit.md
git add -u .env.production dataconnect/.dataconnect/pgliteData
git commit -m "fix: remove tracked secrets and generated local artifacts"
```

Expected: commit succeeds.

### Task 7: Restore Player Search Route Contract

**Files:**
- Modify: `src/app/api/players/search/route.ts`
- Modify: `src/app/api/players/search/route.test.ts`

- [ ] **Step 1: Rewrite tests around StatsReadService fallback semantics**

In `src/app/api/players/search/route.test.ts`, mock `@/server/stats/StatsReadService` instead of the retired precomputed-stats path:

```ts
const resolveSeasonMock = vi.fn();
const ensureSeasonReadyMock = vi.fn();
const getSeasonSummaryMapMock = vi.fn();

vi.mock('@/server/stats/StatsReadService', () => ({
  statsReadService: {
    resolveSeason: (...args: unknown[]) => resolveSeasonMock(...args),
    ensureSeasonReady: (...args: unknown[]) => ensureSeasonReadyMock(...args),
    getSeasonSummaryMap: (...args: unknown[]) => getSeasonSummaryMapMock(...args),
  },
}));
```

Add a regression test:

```ts
it('returns local player results when stat projections are unavailable', async () => {
  resolveSeasonMock.mockResolvedValue(2026);
  ensureSeasonReadyMock.mockRejectedValue(new Error('projection unavailable'));
  getSeasonSummaryMapMock.mockResolvedValue(new Map());

  const { GET } = await import('./route');
  const response = await GET(new Request('http://localhost/api/players/search?q=fonti') as any);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.players.length).toBeGreaterThan(0);
  expect(body.players[0].stats).toEqual({});
});
```

- [ ] **Step 2: Run player search tests to verify failure**

Run:

```bash
npx vitest run src/app/api/players/search/route.test.ts
```

Expected: FAIL with the current 500 behavior.

- [ ] **Step 3: Isolate stats enrichment in the route**

In `src/app/api/players/search/route.ts`, wrap StatsReadService usage in a helper shaped like:

```ts
async function loadSearchStats(seasonInput: string | null) {
  try {
    const season = await statsReadService.resolveSeason(seasonInput);
    await statsReadService.ensureSeasonReady(season);
    return await statsReadService.getSeasonSummaryMap(season);
  } catch (error) {
    logger.warn('Player search stats enrichment unavailable', {
      message: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}
```

Use the returned map for enrichment. Do not catch errors from local player loading in this helper; only projection enrichment should degrade.

- [ ] **Step 4: Run player search tests**

Run:

```bash
npx vitest run src/app/api/players/search/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected: player search failures are gone; remaining failures are limited to unrelated tests already listed by the audit.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/app/api/players/search/route.ts src/app/api/players/search/route.test.ts
git commit -m "fix: make player search degrade when stats projections are unavailable"
```

Expected: commit succeeds.

### Task 8: Make AuthForm Submit Test Deterministic

**Files:**
- Modify: `src/components/__tests__/AuthForm.test.tsx`
- Modify: `src/components/AuthForm.tsx` only if the test exposes a real component bug.

- [ ] **Step 1: Run the focused failing test**

Run:

```bash
npx vitest run src/components/__tests__/AuthForm.test.tsx -t "handles form submission with valid credentials"
```

Expected: FAIL or timeout reproduces.

- [ ] **Step 2: Update the test to wait for the observable submit call**

In `src/components/__tests__/AuthForm.test.tsx`, use this pattern:

```tsx
await user.type(screen.getByLabelText(/email/i), 'user@example.com');
await user.type(screen.getByLabelText(/password/i), 'correct-password');
await user.click(screen.getByRole('button', { name: /sign in/i }));

await waitFor(() => {
  expect(onSubmit).toHaveBeenCalledWith({
    email: 'user@example.com',
    password: 'correct-password',
  });
});
```

If the component submits a different object shape, assert the exact shape currently emitted by the component and keep the test about behavior rather than timers.

- [ ] **Step 3: Fix component behavior only if the deterministic test proves a real bug**

If the component never calls `onSubmit`, update `src/components/AuthForm.tsx` so the submit handler awaits validation once and then calls the supplied callback exactly once:

```tsx
const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const nextErrors = validateAuthForm(values);
  setErrors(nextErrors);
  if (Object.keys(nextErrors).length > 0) return;
  await onSubmit(values);
};
```

Keep existing labels, accessible names, and error messaging.

- [ ] **Step 4: Run focused AuthForm test**

Run:

```bash
npx vitest run src/components/__tests__/AuthForm.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected: PASS after Task 7 and this task.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/components/__tests__/AuthForm.test.tsx src/components/AuthForm.tsx
git commit -m "test: make auth form submit behavior deterministic"
```

Expected: commit succeeds. If `src/components/AuthForm.tsx` was not changed, omit it from `git add`.

### Task 9: Add Safe Help for Read-Model Scripts

**Files:**
- Modify: `Scripts/build-player-read-models.ts`
- Modify: `Scripts/verify-player-read-models.ts`
- Modify: `Scripts/verify-player-read-models-core.ts`
- Test: `tests/verify-player-read-models-core.test.ts`

- [ ] **Step 1: Add parser tests for help mode**

In `tests/verify-player-read-models-core.test.ts`, add:

```ts
it('parses help without requiring live dependencies', () => {
  expect(parseVerifyPlayerReadModelsArgs(['--help'])).toMatchObject({
    help: true,
  });
});
```

- [ ] **Step 2: Run parser test to verify failure**

Run:

```bash
npx vitest run tests/verify-player-read-models-core.test.ts -t "parses help"
```

Expected: FAIL because `help` is not parsed.

- [ ] **Step 3: Add help fields and usage text**

In `Scripts/verify-player-read-models-core.ts`, extend the parsed args type with:

```ts
help: boolean;
```

Set it in the parser:

```ts
help: argv.includes('--help') || argv.includes('-h'),
```

Export usage text:

```ts
export const VERIFY_PLAYER_READ_MODELS_USAGE = `Usage:
  npm run verify:player-read-models -- --season 2026 --rounds 0,1 --data-source afltables,footywire_match --include-merged-live --json

Options:
  --season <year>                AFL season to verify
  --rounds <list>                Comma-separated bounded round list
  --player-id <canonical-id>     Verify one player
  --include-merged-live          Compare merged source rows against raw and projection rows
  --data-source <sources>        Source list, default afltables,footywire_match
  --merged-timeout-ms <number>   Timeout for merged live source loading
  --json                         Emit JSON output
  --trace                        Emit stage timing diagnostics
  --help                         Print this usage text
`;
```

- [ ] **Step 4: Add early help handling in script entrypoints**

At the top of `Scripts/verify-player-read-models.ts`, before imports that initialize Firebase or Prisma, structure the file so it checks raw `process.argv` first:

```ts
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const { VERIFY_PLAYER_READ_MODELS_USAGE } = await import('./verify-player-read-models-core');
  console.log(VERIFY_PLAYER_READ_MODELS_USAGE);
  process.exit(0);
}
```

In `Scripts/build-player-read-models.ts`, add equivalent early handling with build usage text:

```ts
const BUILD_PLAYER_READ_MODELS_USAGE = `Usage:
  npm run build:player-read-models -- --mode full --season 2026 --rounds 0,1

Options:
  --mode <full|refresh|publish>  Build mode
  --season <year>                AFL season to build
  --rounds <list>                Comma-separated bounded round list
  --league-id <id>               Optional league scope
  --help                         Print this usage text
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(BUILD_PLAYER_READ_MODELS_USAGE);
  process.exit(0);
}
```

If static imports currently initialize services before this branch, convert those live imports to dynamic imports after the help branch.

- [ ] **Step 5: Run help commands**

Run:

```bash
npm run build:player-read-models -- --help
npm run verify:player-read-models -- --help
```

Expected: both print usage and exit 0 without Firebase or Prisma initialization errors.

- [ ] **Step 6: Run verifier tests**

Run:

```bash
npx vitest run tests/verify-player-read-models-core.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add Scripts/build-player-read-models.ts Scripts/verify-player-read-models.ts Scripts/verify-player-read-models-core.ts tests/verify-player-read-models-core.test.ts
git commit -m "fix: make read-model scripts safe to inspect"
```

Expected: commit succeeds.

### Task 10: Make Footywire Drift Verification Strict

**Files:**
- Modify: `Scripts/verify-player-read-models-core.ts`
- Modify: `tests/verify-player-read-models-core.test.ts`

- [ ] **Step 1: Add strict dropped-row tests**

In `tests/verify-player-read-models-core.test.ts`, add:

```ts
it('fails when merged rows are dropped before raw persistence', async () => {
  const output = await runVerifyPlayerReadModels(
    parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0', '--include-merged-live']),
    {
      loadMergedRows: async () => [row()],
      loadRawRows: async () => [],
      loadProjectionRows: async () => [],
      loadSeasonSummaryRows: async () => [],
      loadPublication: async () => null,
      resolvePublishedSeason: async () => 2026,
    }
  );

  expect(output.status).toBe('fail');
  expect(output.mismatchesByClass.dropped_before_raw).toBe(1);
});

it('fails when raw rows are dropped before projection persistence', async () => {
  const output = await runVerifyPlayerReadModels(
    parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0']),
    {
      loadMergedRows: async () => [],
      loadRawRows: async () => [row()],
      loadProjectionRows: async () => [],
      loadSeasonSummaryRows: async () => [],
      loadPublication: async () => null,
      resolvePublishedSeason: async () => 2026,
    }
  );

  expect(output.status).toBe('fail');
  expect(output.mismatchesByClass.dropped_in_projection).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run tests/verify-player-read-models-core.test.ts -t "fails when"
```

Expected: FAIL if verifier still returns `warn`.

- [ ] **Step 3: Make dropped classes fail**

In `Scripts/verify-player-read-models-core.ts`, update status resolution so any count for these classes returns `fail`:

```ts
const blockingMismatchClasses = ['dropped_before_raw', 'dropped_in_projection'] as const;
const hasBlockingMismatch = blockingMismatchClasses.some(
  (className) => (mismatchesByClass[className] ?? 0) > 0
);

const status = hasBlockingMismatch || aggregateCheck.status === 'fail' ? 'fail' : warningStatus;
```

Preserve existing warning behavior for non-blocking mismatch classes.

- [ ] **Step 4: Run verifier tests**

Run:

```bash
npx vitest run tests/verify-player-read-models-core.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add Scripts/verify-player-read-models-core.ts tests/verify-player-read-models-core.test.ts
git commit -m "fix: fail verification on dropped Footywire rows"
```

Expected: commit succeeds.

### Task 11: Make Import Repair Operationally Complete

**Files:**
- Modify: `src/app/api/etl/import-rounds/route.ts`
- Modify: `src/app/api/etl/import-rounds/route.test.ts`
- Modify: `src/server/readModels/playerReadModels.ts` if bounded publication helpers are missing.

- [ ] **Step 1: Update import route tests for merged verifier command and publication**

In `src/app/api/etl/import-rounds/route.test.ts`, add expectations to the successful import test:

```ts
expect(body.result.audit.verifierCommand).toBe(
  'npm run verify:player-read-models -- --season 2026 --rounds 0,1 --data-source afltables,footywire_match --include-merged-live --json'
);
expect(body.result.audit.rematerialization).toMatchObject({
  refreshedRounds: [0, 1],
  rankingsDirty: false,
  rostersDirty: false,
  published: true,
});
```

Mock publication helpers:

```ts
const publishPlayerRankingsMock = vi.fn();
const publishLeagueRosterSummariesMock = vi.fn();

vi.mock('@/server/readModels/playerReadModels', () => ({
  refreshPlayerReadModels: refreshPlayerReadModelsMock,
  publishPlayerRankings: publishPlayerRankingsMock,
  publishLeagueRosterSummaries: publishLeagueRosterSummariesMock,
}));
```

- [ ] **Step 2: Run import route tests to verify failure**

Run:

```bash
npx vitest run src/app/api/etl/import-rounds/route.test.ts
```

Expected: FAIL because the verifier command omits `--include-merged-live` and import does not publish dependent projections.

- [ ] **Step 3: Publish bounded dependent projections after successful import**

In `src/app/api/etl/import-rounds/route.ts`, import:

```ts
import {
  publishLeagueRosterSummaries,
  publishPlayerRankings,
  refreshPlayerReadModels,
} from '@/server/readModels/playerReadModels';
```

After `refreshPlayerReadModels`, run:

```ts
const rankingResult = dryRun
  ? null
  : await publishPlayerRankings({ season, rounds: resolvedRounds });
const rosterResult = dryRun
  ? null
  : await publishLeagueRosterSummaries({ season, rounds: resolvedRounds });
```

The publication result in the response must mark dirty flags false only when publication succeeds:

```ts
const rankingsDirty = publication.rankingsDirty && !rankingResult?.published;
const rostersDirty = publication.rostersDirty && !rosterResult?.published;
```

- [ ] **Step 4: Include merged live verification in the returned command**

Build the verifier command as:

```ts
const verifierCommand = `npm run verify:player-read-models -- --season ${season} --rounds ${resolvedRounds.join(
  ','
)} --data-source ${dataSource} --include-merged-live --json`;
```

- [ ] **Step 5: Run import route tests**

Run:

```bash
npx vitest run src/app/api/etl/import-rounds/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused Footywire tests**

Run:

```bash
npx vitest run src/app/api/etl/import-rounds/route.test.ts src/app/api/cron/daily/route.test.ts src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/app/api/etl/import-rounds/route.ts src/app/api/etl/import-rounds/route.test.ts src/server/readModels/playerReadModels.ts
git commit -m "fix: publish dependent read models after Footywire import"
```

Expected: commit succeeds. If `src/server/readModels/playerReadModels.ts` was not changed, omit it from `git add`.

### Task 12: Centralize Footywire Source Priority

**Files:**
- Modify: `src/lib/stats/footywireCanonicalContract.ts`
- Modify: `src/lib/stats/footywireCanonicalContract.test.ts`
- Modify: `src/lib/footywireStatsIngestion.ts`
- Modify: `src/lib/footywireStatsIngestion.test.ts`
- Modify: `etl/processFootywireData.ts`
- Modify: `src/server/processFootywireData.test.ts`

- [ ] **Step 1: Add canonical source priority tests**

In `src/lib/stats/footywireCanonicalContract.test.ts`, add:

```ts
import {
  FOOTYWIRE_SOURCE_PRIORITY,
  normalizeFootywireSourceName,
  compareFootywireSourcePriority,
} from './footywireCanonicalContract';

it('defines source priority once for all Footywire producers', () => {
  expect(FOOTYWIRE_SOURCE_PRIORITY).toEqual([
    'fitzroy_merged',
    'footywire_match',
    'afltables',
    'legacy_top_level',
  ]);
});

it('normalizes producer source aliases', () => {
  expect(normalizeFootywireSourceName('fryzigg')).toBe('fitzroy_merged');
  expect(normalizeFootywireSourceName('footywire')).toBe('footywire_match');
  expect(normalizeFootywireSourceName('afltables')).toBe('afltables');
});

it('sorts preferred sources before lower-priority sources', () => {
  expect(compareFootywireSourcePriority('fitzroy_merged', 'afltables')).toBeLessThan(0);
  expect(compareFootywireSourcePriority('legacy_top_level', 'footywire_match')).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run canonical contract tests to verify failure**

Run:

```bash
npx vitest run src/lib/stats/footywireCanonicalContract.test.ts
```

Expected: FAIL because exported helpers are missing or local priority differs.

- [ ] **Step 3: Implement canonical source priority helpers**

In `src/lib/stats/footywireCanonicalContract.ts`, export:

```ts
export const FOOTYWIRE_SOURCE_PRIORITY = [
  'fitzroy_merged',
  'footywire_match',
  'afltables',
  'legacy_top_level',
] as const;

export type FootywireCanonicalSource = (typeof FOOTYWIRE_SOURCE_PRIORITY)[number];

const FOOTYWIRE_SOURCE_ALIASES: Record<string, FootywireCanonicalSource> = {
  fitzroy_merged: 'fitzroy_merged',
  fryzigg: 'fitzroy_merged',
  footywire_match: 'footywire_match',
  footywire: 'footywire_match',
  afltables: 'afltables',
  legacy_top_level: 'legacy_top_level',
};

export function normalizeFootywireSourceName(source: string): FootywireCanonicalSource {
  return FOOTYWIRE_SOURCE_ALIASES[source] ?? 'legacy_top_level';
}

export function footywireSourcePriority(source: string): number {
  const normalized = normalizeFootywireSourceName(source);
  return FOOTYWIRE_SOURCE_PRIORITY.indexOf(normalized);
}

export function compareFootywireSourcePriority(left: string, right: string): number {
  return footywireSourcePriority(left) - footywireSourcePriority(right);
}
```

- [ ] **Step 4: Replace local source-priority logic**

In `src/lib/footywireStatsIngestion.ts` and `etl/processFootywireData.ts`, remove local priority arrays/maps and use:

```ts
import {
  compareFootywireSourcePriority,
  normalizeFootywireSourceName,
} from '@/lib/stats/footywireCanonicalContract';
```

When persisting provenance, store `normalizeFootywireSourceName(source)` instead of the producer alias.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run src/lib/stats/footywireCanonicalContract.test.ts src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/stats/footywireCanonicalContract.ts src/lib/stats/footywireCanonicalContract.test.ts src/lib/footywireStatsIngestion.ts src/lib/footywireStatsIngestion.test.ts etl/processFootywireData.ts src/server/processFootywireData.test.ts
git commit -m "refactor: centralize Footywire source priority"
```

Expected: commit succeeds.

### Task 13: Preserve Provenance Through Match-Log Projection Storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_match_log_provenance/migration.sql`
- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/server/readModels/playerReadModels.test.ts`
- Modify: `tests/verify-player-read-models-core.test.ts`

- [ ] **Step 1: Add projection provenance test**

In `src/server/readModels/playerReadModels.test.ts`, add an assertion that projected match-log rows contain provenance:

```ts
expect(projectedRow).toMatchObject({
  stats: expect.objectContaining({ disposals: 10 }),
  availability: expect.objectContaining({ disposals: true }),
  provenance: expect.objectContaining({ disposals: 'fitzroy_merged' }),
});
```

Use the existing projected row variable from the match-log projection test. If the test currently only inspects `statsJson`, parse it first:

```ts
const statsJson = JSON.parse(projectedRow.statsJson);
expect(statsJson.provenance.disposals).toBe('fitzroy_merged');
```

- [ ] **Step 2: Run read-model tests to verify failure**

Run:

```bash
npx vitest run src/server/readModels/playerReadModels.test.ts
```

Expected: FAIL because provenance is not persisted through the projection.

- [ ] **Step 3: Add schema support**

In `prisma/schema.prisma`, add a JSON field to the match-log projection model:

```prisma
provenanceJson Json?
```

Create migration SQL:

```sql
ALTER TABLE "PlayerMatchLogProjection" ADD COLUMN "provenanceJson" JSONB;
```

Use the actual table name and column type emitted by Prisma for the current database provider if it differs.

- [ ] **Step 4: Persist provenance**

In `src/server/readModels/playerReadModels.ts`, include provenance when building projection rows:

```ts
const projectionPayload = {
  statsJson: stats,
  availabilityJson: availability,
  provenanceJson: provenance,
};
```

When reading projection rows for verification, hydrate provenance back into the stage snapshot:

```ts
stage: buildMatchLogStageSnapshot(stats, {
  availability,
  provenance,
});
```

- [ ] **Step 5: Run Prisma generation and tests**

Run:

```bash
npx prisma generate
npx vitest run src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add prisma/schema.prisma prisma/migrations src/server/readModels/playerReadModels.ts src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts
git commit -m "feat: preserve Footywire provenance in match-log projections"
```

Expected: commit succeeds.

### Task 14: Remove Production Draft Debug and Force Controls

**Files:**
- Modify: `src/components/draft/DraftContainer.tsx`
- Test: existing draft component tests or new `src/components/draft/DraftContainer.test.tsx`

- [ ] **Step 1: Add regression test for production controls**

Create or update `src/components/draft/DraftContainer.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DraftContainer } from './DraftContainer';

describe('DraftContainer production controls', () => {
  it('does not render debug or force-entry controls', () => {
    render(<DraftContainer draftId="draft-1" leagueId="league-1" />);

    expect(screen.queryByText(/FORCED MODE/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Force Lobby/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Force Enter Draft Room/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Test API/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Debug: Status/i)).not.toBeInTheDocument();
  });
});
```

Mock required hooks/services in the same style as nearby draft tests.

- [ ] **Step 2: Run draft test to verify failure**

Run:

```bash
npx vitest run src/components/draft/DraftContainer.test.tsx
```

Expected: FAIL if debug controls still render.

- [ ] **Step 3: Remove production debug controls**

In `src/components/draft/DraftContainer.tsx`, remove controls and links containing:

```text
/test-draft
Debug: Status
FORCED MODE
Force Lobby
Force Enter Draft Room
Test API
```

If local diagnostics are still needed, render them only through a separate dev-only component guarded by:

```tsx
const showLocalDiagnostics = process.env.NODE_ENV === 'development';
```

Do not show force-entry or bypass controls in production markup.

- [ ] **Step 4: Verify search is clean**

Run:

```bash
rg -n "Force Lobby|Force Enter Draft Room|FORCED MODE|Debug: Status|Test API|/test-draft" src/components/draft src/app/drafts
```

Expected: no production UI matches. A dev-only diagnostics file may match only if it is explicitly local guarded.

- [ ] **Step 5: Run focused draft test**

Run:

```bash
npx vitest run src/components/draft/DraftContainer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/components/draft/DraftContainer.tsx src/components/draft/DraftContainer.test.tsx
git commit -m "fix: remove production draft debug controls"
```

Expected: commit succeeds.

### Task 15: Restore Formatting Gate in an Isolated Commit

**Files:**
- Modify only files reported by `npm run format:check`.

- [ ] **Step 1: Confirm formatting drift**

Run:

```bash
npm run format:check
```

Expected: FAIL and list remaining unformatted files.

- [ ] **Step 2: Format the repository**

Run:

```bash
npm run format
```

Expected: Prettier rewrites formatting only.

- [ ] **Step 3: Confirm no semantic changes were introduced**

Run:

```bash
git diff --stat
git diff --check
```

Expected: diff is formatting-only and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Run formatting check**

Run:

```bash
npm run format:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add .
git commit -m "style: format repository"
```

Expected: commit succeeds.

### Task 16: Add Data Typecheck to the Release Gate

**Files:**
- Modify: `tsconfig.data.json` and data-surface files needed to make the project pass.
- Modify: `package.json`
- Modify: `.github/workflows/*.yml` if CI invokes checks directly instead of `npm run prepush:ci`.

- [ ] **Step 1: Reproduce data typecheck failures**

Run:

```bash
npm run typecheck:data
```

Expected: FAIL with strict optional/indexing errors.

- [ ] **Step 2: Fix data type errors without weakening compiler strictness**

For each failure, prefer narrowing over `as any`. Use patterns like:

```ts
const value = record[key];
if (value === undefined) return null;
return value;
```

For optional numeric stats, use:

```ts
const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
```

Do not remove files from `tsconfig.data.json` unless the file is not part of the data surface.

- [ ] **Step 3: Run data typecheck**

Run:

```bash
npm run typecheck:data
```

Expected: PASS.

- [ ] **Step 4: Add data typecheck to prepush**

In `package.json`, change:

```json
"prepush:ci": "npm run typecheck && npm run lint && npm run env:check:firebase && npm run guard:routes && npm run guard:tracked-artifacts && npm run guard:deps && npm test && npm run format:check"
```

to:

```json
"prepush:ci": "npm run typecheck && npm run typecheck:data && npm run lint && npm run env:check:firebase && npm run guard:routes && npm run guard:tracked-artifacts && npm run guard:deps && npm test && npm run format:check"
```

- [ ] **Step 5: Run release gate**

Run:

```bash
npm run prepush:ci
```

Expected: PASS after earlier tasks.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json tsconfig.data.json etl src Scripts tests .github/workflows
git commit -m "fix: enforce data typecheck in release gate"
```

Expected: commit succeeds. Only add paths that actually changed.

### Task 17: Fix Navigation Disclosure Accessibility

**Files:**
- Modify: `src/components/layout/MainNavigation.tsx`
- Test: existing navigation tests or new `src/components/layout/MainNavigation.test.tsx`

- [ ] **Step 1: Add disclosure semantics test**

Create or update `src/components/layout/MainNavigation.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MainNavigation } from './MainNavigation';

describe('MainNavigation tools menu accessibility', () => {
  it('exposes disclosure state and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<MainNavigation />);

    const trigger = screen.getByRole('button', { name: /tools/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run navigation test to verify failure**

Run:

```bash
npx vitest run src/components/layout/MainNavigation.test.tsx
```

Expected: FAIL because disclosure semantics or Escape focus return are incomplete.

- [ ] **Step 3: Implement disclosure semantics**

In `src/components/layout/MainNavigation.tsx`, give the trigger:

```tsx
aria-haspopup="menu"
aria-expanded={toolsOpen}
aria-controls="main-navigation-tools-menu"
```

Give the menu:

```tsx
id="main-navigation-tools-menu"
role="menu"
```

On Escape, close the menu and return focus to the trigger:

```tsx
if (event.key === 'Escape') {
  setToolsOpen(false);
  toolsButtonRef.current?.focus();
}
```

- [ ] **Step 4: Run navigation test**

Run:

```bash
npx vitest run src/components/layout/MainNavigation.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/layout/MainNavigation.tsx src/components/layout/MainNavigation.test.tsx
git commit -m "fix: improve tools menu accessibility"
```

Expected: commit succeeds.

### Task 18: Fix Draft Player Grid Semantics

**Files:**
- Modify: `src/components/draft/PlayerGrid.tsx`
- Test: existing grid test or new `src/components/draft/PlayerGrid.test.tsx`

- [ ] **Step 1: Add semantic structure test**

Create or update `src/components/draft/PlayerGrid.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlayerGrid } from './PlayerGrid';

const players = [
  { id: 'p1', name: 'Player One', club: 'GWS', position: 'MID' },
  { id: 'p2', name: 'Player Two', club: 'CARL', position: 'FWD' },
];

describe('PlayerGrid semantics', () => {
  it('renders a labelled list without orphan table roles', () => {
    render(<PlayerGrid players={players as any} />);

    expect(screen.getByRole('list', { name: /players/i })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('rowgroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run player grid test to verify failure**

Run:

```bash
npx vitest run src/components/draft/PlayerGrid.test.tsx
```

Expected: FAIL if pseudo-table roles remain.

- [ ] **Step 3: Replace orphan roles with list semantics**

In `src/components/draft/PlayerGrid.tsx`, change the container to:

```tsx
<div role="list" aria-label="Players" className={gridClassName}>
  {players.map((player) => (
    <article role="listitem" key={player.id} className={playerCardClassName}>
      ...
    </article>
  ))}
</div>
```

Remove `role="rowgroup"` and `role="row"` unless the component is changed into a full `role="grid"` with `role="gridcell"` children.

- [ ] **Step 4: Run player grid test**

Run:

```bash
npx vitest run src/components/draft/PlayerGrid.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/draft/PlayerGrid.tsx src/components/draft/PlayerGrid.test.tsx
git commit -m "fix: use valid draft player grid semantics"
```

Expected: commit succeeds.

### Task 19: Split LeagueTabs Into Focused Client Islands

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Create: `src/components/league/LeagueNavigationTabs.tsx`
- Create: `src/components/league/LeagueRosterPanel.tsx`
- Create: `src/components/league/LeagueSettingsPanel.tsx`
- Create: `src/components/league/LeagueResearchPanel.tsx`
- Modify: `src/components/league/LeagueTabs.test.tsx`

- [ ] **Step 1: Record current behavior with tests**

Run:

```bash
npx vitest run src/components/league/LeagueTabs.test.tsx
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract navigation component**

Create `src/components/league/LeagueNavigationTabs.tsx`:

```tsx
'use client';

type LeagueNavigationTabsProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  tabs: Array<{ id: string; label: string }>;
};

export function LeagueNavigationTabs({
  activeTab,
  onTabChange,
  tabs,
}: LeagueNavigationTabsProps) {
  return (
    <div role="tablist" aria-label="League sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Extract roster, settings, and research panels**

Move existing JSX without changing behavior into:

```tsx
export function LeagueRosterPanel(props: LeagueRosterPanelProps) {
  return <section aria-labelledby="league-roster-heading">{props.children}</section>;
}
```

```tsx
export function LeagueSettingsPanel(props: LeagueSettingsPanelProps) {
  return <section aria-labelledby="league-settings-heading">{props.children}</section>;
}
```

```tsx
export function LeagueResearchPanel(props: LeagueResearchPanelProps) {
  return <section aria-labelledby="league-research-heading">{props.children}</section>;
}
```

Use explicit props copied from the state and callbacks currently used by each section in `LeagueTabs.tsx`.

- [ ] **Step 4: Wire extracted components**

In `src/components/league/LeagueTabs.tsx`, import the new components:

```tsx
import { LeagueNavigationTabs } from './LeagueNavigationTabs';
import { LeagueResearchPanel } from './LeagueResearchPanel';
import { LeagueRosterPanel } from './LeagueRosterPanel';
import { LeagueSettingsPanel } from './LeagueSettingsPanel';
```

Replace the moved JSX with the extracted components and pass existing props directly.

- [ ] **Step 5: Run league tests and typecheck**

Run:

```bash
npx vitest run src/components/league/LeagueTabs.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/components/league/LeagueTabs.tsx src/components/league/LeagueNavigationTabs.tsx src/components/league/LeagueRosterPanel.tsx src/components/league/LeagueSettingsPanel.tsx src/components/league/LeagueResearchPanel.tsx src/components/league/LeagueTabs.test.tsx
git commit -m "refactor: split league tabs into focused panels"
```

Expected: commit succeeds.

### Task 20: Replace High-Impact Native Confirm and Alert Flows

**Files:**
- Modify files found by `rg -n "window\\.confirm|window\\.alert|confirm\\(|alert\\(" src/components src/app`
- Prefer existing dialog primitives under `src/components/ui`.
- Test changed high-impact actions.

- [ ] **Step 1: Inventory native dialogs**

Run:

```bash
rg -n "window\\.confirm|window\\.alert|confirm\\(|alert\\(" src/components src/app
```

Expected: high-impact roster/draft actions are listed.

- [ ] **Step 2: Add a confirmation dialog test for one roster action**

For the first high-impact roster action, add a test shaped like:

```tsx
await user.click(screen.getByRole('button', { name: /remove player/i }));
expect(screen.getByRole('dialog', { name: /remove player/i })).toBeInTheDocument();

await user.click(screen.getByRole('button', { name: /confirm/i }));
await waitFor(() => {
  expect(removePlayer).toHaveBeenCalledWith(expectedPlayerId);
});
```

- [ ] **Step 3: Replace native confirm with app dialog**

Use the existing shadcn dialog primitive already present in the repository. The final interaction must have:

```tsx
<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Remove player</DialogTitle>
      <DialogDescription>
        This removes the player from the roster action queue.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
        Cancel
      </Button>
      <Button type="button" variant="destructive" onClick={confirmRemovePlayer}>
        Confirm
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Use semantic theme variants, keep keyboard focus inside the dialog, and remove native `confirm`.

- [ ] **Step 4: Run affected UI tests**

Run:

```bash
npx vitest run src/components/league/LeagueTabs.test.tsx src/components/draft/DraftContainer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Confirm no high-impact native dialogs remain**

Run:

```bash
rg -n "window\\.confirm|window\\.alert|confirm\\(|alert\\(" src/components src/app
```

Expected: no high-impact roster/draft mutation actions remain. Any remaining matches are harmless browser APIs or test assertions with a clear file-local reason.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/components src/app
git commit -m "fix: replace high-impact native dialogs with app dialogs"
```

Expected: commit succeeds.

### Task 21: Final Verification and Release Gate

**Files:**
- Modify: `docs/audits/2026-04-29-full-code-audit.md`
- Modify: `docs/audits/2026-04-29-full-code-audit-evidence.md`

- [ ] **Step 1: Run full local release gate**

Run:

```bash
npm run prepush:ci
```

Expected: PASS.

- [ ] **Step 2: Run focused Footywire convergence checks**

Run:

```bash
npx vitest run src/lib/stats/footywireCanonicalContract.test.ts src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run bounded verification command for repaired rounds**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --data-source afltables,footywire_match --include-merged-live --json
```

Expected: command exits 0 and JSON status is `pass`. `mismatchesByClass.dropped_before_raw` and `mismatchesByClass.dropped_in_projection` are both `0`.

- [ ] **Step 4: Confirm security and artifact cleanup**

Run:

```bash
git ls-files .env.production
git ls-files dataconnect/.dataconnect/pgliteData
npm run guard:secrets
npm run guard:tracked-artifacts
rg -n "refreshLiveStatsIfNeeded" src/app/api src/lib
rg -n "Force Lobby|Force Enter Draft Room|FORCED MODE|Debug: Status|Test API|/test-draft" src/components/draft src/app/drafts
```

Expected: tracked secret/artifact commands print nothing; guards pass; live refresh is present only in authorized mutation paths; production draft debug search returns no production UI matches.

- [ ] **Step 5: Update audit status**

In `docs/audits/2026-04-29-full-code-audit.md`, change fixed findings from:

```markdown
- Status: Open
```

to:

```markdown
- Status: Fixed in `codex/audit-remediation`
```

Add the exact verification commands from this task to `docs/audits/2026-04-29-full-code-audit-evidence.md`.

- [ ] **Step 6: Commit verification docs**

Run:

```bash
git add docs/audits/2026-04-29-full-code-audit.md docs/audits/2026-04-29-full-code-audit-evidence.md
git commit -m "docs: record audit remediation verification"
```

Expected: commit succeeds.

## Self-Review

### Spec Coverage

- P0 tracked `.env.production` and standalone secret output: Task 6.
- P0 unauthenticated admin worker and queue APIs: Tasks 2 and 3.
- P1 public read endpoints mutating live data: Task 5.
- P1 fail-open cron and repair routes: Task 4.
- P1 verifier warning while dropped rows remain: Task 10.
- P1 import verifier missing merged live comparison: Task 11.
- P1 import leaves dependent projections stale: Task 11.
- P1 production draft debug and force controls: Task 14.
- P1 player search route contract failure: Task 7.
- P1 full Vitest failures: Tasks 7 and 8.
- P2 formatting drift: Task 15.
- P2 artifact guard gap: Task 6.
- P2 read-model help behavior: Task 9.
- P2 duplicated source priority: Task 12.
- P2 provenance loss in projections: Task 13.
- P2 broken `typecheck:data`: Task 16.
- P2 UI/accessibility drift: Tasks 17 through 20.

### Red-Flag Scan

Every implementation task includes exact files, commands, expected outcomes, and concrete code shapes for the intended change.

### Type Consistency

Shared helper names are consistent across tasks: `authorizeAdminRequest`, `authorizeCronRequest`, `authorizeLocalOnlyRequest`, `normalizeFootywireSourceName`, `compareFootywireSourcePriority`, and `VERIFY_PLAYER_READ_MODELS_USAGE`.

# Go-Live Remediation Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish release-grade evidence that Statly can go live safely by converting every P0 finding into an enforced contract, test, or explicit launch decision.

**Architecture:** Go-live readiness is treated as a set of durable contracts rather than a pile of route patches. Route access policy is centralized, identity-sensitive routes bind to authenticated users, legacy/debug surfaces fail closed, realtime delivery is idempotent, browser workflow evidence is recorded, and design drift is either fixed for launch-critical surfaces or accepted with expiry.

**Tech Stack:** Next.js App Router, Next.js Pages API, TypeScript, Vitest, Testing Library, Firebase Admin, Prisma, Socket.IO, BullMQ, existing shadcn-style UI conventions, existing npm guard scripts.

---

## Assessment

### Intended Goal

The remediation work must prove that Statly is safe to launch, not merely that more tests exist. The desired end state is a repeatable release process where high-impact behavior is protected by code-level contracts and backed by evidence.

The plan must answer these launch questions:

- Can unauthenticated users reach only public surfaces?
- Can authenticated users mutate only their own data or league-authorized data?
- Can operational endpoints mutate state only through explicit operational authorization?
- Can dev/debug/fixture routes run only in explicit local runtime?
- Can realtime draft events be delivered more than once without double-applying state?
- Can core users complete launch workflows in a browser?
- Can design-system drift be fixed or consciously accepted without hiding broken core UI?

### Shortcomings In The Previous Plan

The previous plan moved in the right direction but still had execution weaknesses:

- It started with individual routes instead of defining the route-policy matrix first.
- It did not make every P0 route family traceable to a policy, test, and launch decision.
- It treated browser evidence as a loose manual task rather than a structured release artifact.
- It placed design drift late without tying it to release exception rules.
- Its realtime section mixed implementation suggestions with the invariant that actually matters: duplicate delivery must not double-apply one logical event.
- It did not clearly distinguish completed hardening from remaining launch blockers.

### Rewritten Direction

This plan is rewritten around contracts:

1. Define route policy once.
2. Enforce local-only and operational route boundaries.
3. Bind user-sensitive routes to authenticated identity.
4. Retire or gate legacy mutable Pages API routes.
5. Prove realtime idempotency.
6. Capture browser workflow evidence.
7. Decide design drift by launch surface.

Do not add a second authorization system. Extend the existing `src/lib/operationalAuth.ts` and `src/lib/serverAuth.ts` patterns.

Do not add Playwright or another browser dependency without explicit approval. Until then, browser evidence is manual or in-app browser based.

---

## Route Policy Matrix

Every P0 route must map to exactly one launch policy. If a route cannot be classified, it is not launch ready.

| Route family                                                          | Policy                                                       | Launch decision                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `/api/admin/workers`                                                  | `admin-token` via `ADMIN_API_TOKEN`                          | Completed in current branch; keep tests.                           |
| `/api/admin/queue`                                                    | `admin-token` via `ADMIN_API_TOKEN`                          | Completed in current branch; keep tests.                           |
| `/api/admin/draft-repair`                                             | `admin-token`                                                | Already token-gated; confirm consistency with shared helper later. |
| `/api/cron/*`                                                         | `cron-token` via `CRON_SECRET`                               | Keep separate from admin token.                                    |
| `/api/inngest`                                                        | `webhook/secret`                                             | Must be verified before launch.                                    |
| `/api/auth/session`                                                   | public boundary, verified Firebase token                     | Add route tests for cookie contract.                               |
| `/api/user/profile/[userId]`                                          | authenticated self                                           | Add identity-binding tests and implementation.                     |
| `/api/user/teams`, `/api/user/watchlists`, `/api/user/draft-settings` | authenticated self                                           | Audit after profile route is fixed.                                |
| `/api/leagues` create/list                                            | authenticated user for mutation, controlled read policy      | Needs route tests before launch.                                   |
| `/api/leagues/join`                                                   | authenticated user                                           | Remove hardcoded invite behavior or local-gate it.                 |
| `/api/leagues/[id]/members`                                           | league member or commissioner depending action               | Needs permission tests.                                            |
| `/api/leagues/[id]/draft-settings`                                    | commissioner/owner                                           | Needs permission tests.                                            |
| `/api/leagues/[id]/actions/[userId]`                                  | authenticated self or commissioner                           | Needs identity and membership tests.                               |
| `/api/leagues/[id]/roster/[userId]`                                   | league member read, authenticated self/commissioner mutation | Needs tests.                                                       |
| `/api/leagues/[id]/waivers/*`                                         | league member or commissioner depending action               | Needs submit/cancel/process tests.                                 |
| `/api/drafts/[id]/*` mutation routes                                  | draft participant or commissioner                            | Needs mutation and member-binding tests.                           |
| `/api/dev/test-user`                                                  | local-only                                                   | Must return 404 outside explicit local runtime.                    |
| `/api/add-test-data`                                                  | local-only                                                   | Must return 404 outside explicit local runtime.                    |
| `/api/create-test-draft`                                              | local-only                                                   | Must return 404 outside explicit local runtime.                    |
| `/api/test-lobby`                                                     | local-only                                                   | Must return 404 outside explicit local runtime.                    |
| `/api/env-check`                                                      | local-only                                                   | Must return 404 outside explicit local runtime.                    |
| `/api/admin-check`                                                    | local-only or admin-token                                    | Prefer local-only unless needed by operators.                      |
| `/api/drafts/[id]/debug`                                              | local-only                                                   | Must return 404 outside explicit local runtime.                    |
| `/api/tradeReview`                                                    | retire or local-only                                         | Gate unless current product callers still need migration.          |
| `/api/listTrades`                                                     | retire or authenticated read                                 | Gate unless current product callers still need migration.          |
| hardcoded personal/demo draft roster routes                           | remove                                                       | Must not ship.                                                     |

---

## File Responsibility Map

- `src/lib/operationalAuth.ts`: operational route policies for admin-token, cron-token, and local-only access.
- `src/lib/operationalAuth.test.ts`: shared policy tests.
- `src/lib/serverAuth.ts`: authenticated user resolution from Firebase session or bearer token.
- `src/app/api/**/route.ts`: App Router route handlers with explicit policy.
- `src/pages/api/tradeReview.ts`: legacy mutable Pages API route; gate or retire.
- `src/pages/api/listTrades.ts`: legacy Pages API route; gate, retire, or migrate.
- `src/server/draft/services/DraftRealtimeDispatcher.ts`: server draft realtime publishing.
- `src/server/draft/domain/draftTypes.ts`: draft realtime event shape and idempotency fields.
- `src/contexts/DraftContext.tsx`: client draft delta application and duplicate protection.
- `docs/GO_LIVE_TEST_EXECUTION_REPORT.md`: evidence log, not the implementation source of truth.
- `docs/GO_LIVE_BROWSER_SMOKE_EVIDENCE.md`: browser smoke evidence artifact created by this plan.
- `docs/audits/go-live-design-drift-decision-2026-05-18.md`: design guard decision artifact created by this plan.

---

## Task 1: Create Route Policy Inventory Artifact

**Files:**

- Create: `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`

- [ ] **Step 1: Create the matrix document**

Create `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`:

```markdown
# Go-Live Route Policy Matrix

Date: 2026-05-18

## Policy Legend

- `public`: reachable without auth and cannot mutate protected data.
- `authenticated-self`: authenticated user may read or mutate only their own user-scoped data.
- `league-member`: authenticated league member may read league-scoped data.
- `commissioner`: league owner/admin/commissioner may mutate league administration data.
- `draft-participant`: authenticated draft participant may mutate only permitted draft state.
- `admin-token`: operational admin token required through `ADMIN_API_TOKEN`.
- `cron-token`: scheduled-job token required through `CRON_SECRET`.
- `webhook-secret`: provider webhook verification required.
- `local-only`: returns 404 outside explicit local runtime.
- `retire`: remove or permanently redirect before launch.

## P0 Routes

| Route                        | Policy                                    | Status   | Evidence                                              |
| ---------------------------- | ----------------------------------------- | -------- | ----------------------------------------------------- |
| `/api/admin/workers`         | `admin-token`                             | complete | `src/app/api/admin/workers/route.test.ts`             |
| `/api/admin/queue`           | `admin-token`                             | complete | `src/app/api/admin/queue/route.test.ts`               |
| `/api/auth/session`          | `public` with Firebase token verification | pending  | add `src/app/api/auth/session/route.test.ts`          |
| `/api/user/profile/[userId]` | `authenticated-self`                      | pending  | add `src/app/api/user/profile/[userId]/route.test.ts` |
| `/api/dev/test-user`         | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/add-test-data`         | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/create-test-draft`     | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/test-lobby`            | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/env-check`             | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/admin-check`           | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/drafts/[id]/debug`     | `local-only`                              | pending  | add `src/app/api/local-only-routes.test.ts`           |
| `/api/tradeReview`           | `retire` or `local-only`                  | pending  | add `src/pages/api/tradeReview.test.ts`               |
| `/api/listTrades`            | `retire` or authenticated read            | pending  | add `src/pages/api/listTrades.test.ts`                |

## Rule

A P0 route may not move to launch-ready until `Status` is `complete` and `Evidence` names a passing test, guard, or documented launch exception.
```

- [ ] **Step 2: Verify formatting**

Run:

```bash
npx prettier --check docs/GO_LIVE_ROUTE_POLICY_MATRIX.md
```

Expected: PASS.

---

## Task 2: Gate Local-Only And Debug Routes

**Files:**

- Modify: `src/lib/operationalAuth.ts`
- Modify: `src/lib/operationalAuth.test.ts`
- Modify: `src/app/api/dev/test-user/route.ts`
- Modify: `src/app/api/add-test-data/route.ts`
- Modify: `src/app/api/create-test-draft/route.ts`
- Modify: `src/app/api/test-lobby/route.ts`
- Modify: `src/app/api/env-check/route.ts`
- Modify: `src/app/api/admin-check/route.ts`
- Modify: `src/app/api/drafts/[id]/debug/route.ts`
- Create: `src/app/api/local-only-routes.test.ts`
- Modify: `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`

- [ ] **Step 1: Write local-only policy test**

Add this test to `src/lib/operationalAuth.test.ts`:

```ts
it('rejects local-only requests outside explicit local runtime', () => {
  vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');

  const result = authorizeLocalOnlyRequest();

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(404);
});
```

- [ ] **Step 2: Write failing route regression tests**

Create `src/app/api/local-only-routes.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    getUser: vi.fn(),
    createUser: vi.fn(),
    createCustomToken: vi.fn(),
  },
  adminDb: {
    collection: vi.fn(() => ({
      limit: vi.fn(() => ({ get: vi.fn() })),
      doc: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })),
    })),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: { count: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/ensureLobbyColumns', () => ({
  ensureLobbyColumns: vi.fn(),
  ensureRosterTables: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  revalidatePlayersTags: vi.fn(),
}));

type HandlerModule = {
  GET?: (request: NextRequest, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST?: (request: NextRequest, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
};

const routes: Array<{
  label: string;
  method: 'GET' | 'POST';
  importRoute: () => Promise<HandlerModule>;
  url: string;
  context?: { params: Promise<{ id: string }> };
}> = [
  {
    label: 'dev test user',
    method: 'POST',
    importRoute: () => import('./dev/test-user/route'),
    url: 'http://localhost/api/dev/test-user',
  },
  {
    label: 'add test data',
    method: 'POST',
    importRoute: () => import('./add-test-data/route'),
    url: 'http://localhost/api/add-test-data',
  },
  {
    label: 'create test draft',
    method: 'POST',
    importRoute: () => import('./create-test-draft/route'),
    url: 'http://localhost/api/create-test-draft',
  },
  {
    label: 'test lobby',
    method: 'GET',
    importRoute: () => import('./test-lobby/route'),
    url: 'http://localhost/api/test-lobby',
  },
  {
    label: 'env check',
    method: 'GET',
    importRoute: () => import('./env-check/route'),
    url: 'http://localhost/api/env-check',
  },
  {
    label: 'admin check',
    method: 'GET',
    importRoute: () => import('./admin-check/route'),
    url: 'http://localhost/api/admin-check',
  },
  {
    label: 'draft debug',
    method: 'GET',
    importRoute: () => import('./drafts/[id]/debug/route'),
    url: 'http://localhost/api/drafts/draft-1/debug',
    context: { params: Promise.resolve({ id: 'draft-1' }) },
  },
];

describe('local-only API routes', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
  });

  it.each(routes)('blocks $label outside explicit local runtime', async (route) => {
    const mod = await route.importRoute();
    const handler = mod[route.method];
    expect(handler).toBeTypeOf('function');

    const response = await handler!(
      new NextRequest(route.url, { method: route.method }),
      route.context
    );

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run src/lib/operationalAuth.test.ts src/app/api/local-only-routes.test.ts --reporter=verbose
```

Expected: FAIL because the listed routes are not all guarded by `authorizeLocalOnlyRequest()`.

- [ ] **Step 4: Apply shared local-only guard**

At the top of each listed route file, add:

```ts
import { authorizeLocalOnlyRequest } from '@/lib/operationalAuth';
```

At the start of each exported handler, before Firebase, Prisma, cache, env, or debug work, add:

```ts
const authorization = authorizeLocalOnlyRequest();
if (!authorization.ok) return authorization.response;
```

For `src/app/api/drafts/[id]/debug/route.ts`, run the guard before reading `params`.

- [ ] **Step 5: Update route policy matrix**

In `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`, change each completed local-only route status from `pending` to `complete` and set evidence to:

```markdown
`src/app/api/local-only-routes.test.ts`
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
npx vitest run src/lib/operationalAuth.test.ts src/app/api/local-only-routes.test.ts --reporter=verbose
```

Expected: PASS.

---

## Task 3: Bind User Profile Routes To Authenticated Identity

**Files:**

- Modify: `src/app/api/user/profile/[userId]/route.ts`
- Create: `src/app/api/user/profile/[userId]/route.test.ts`
- Modify: `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`

- [ ] **Step 1: Write failing identity-binding tests**

Create `src/app/api/user/profile/[userId]/route.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const getUserProfileMock = vi.fn();
const updateUserProfileMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/services/userProfileService', () => ({
  userProfileService: {
    getUserProfile: getUserProfileMock,
    updateUserProfile: updateUserProfileMock,
  },
}));

const context = (userId: string) => ({ params: Promise.resolve({ userId }) });

describe('/api/user/profile/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    getUserProfileMock.mockResolvedValue({ id: 'user-1', displayName: 'User One' });
    updateUserProfileMock.mockResolvedValue({ id: 'user-1', displayName: 'Updated' });
  });

  it('rejects unauthenticated profile reads', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/user-1'),
      context('user-1')
    );

    expect(response.status).toBe(401);
    expect(getUserProfileMock).not.toHaveBeenCalled();
  });

  it('rejects reads for a different user id', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/user-2'),
      context('user-2')
    );

    expect(response.status).toBe(403);
    expect(getUserProfileMock).not.toHaveBeenCalled();
  });

  it('allows a user to read their own profile', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/user-1'),
      context('user-1')
    );

    expect(response.status).toBe(200);
    expect(getUserProfileMock).toHaveBeenCalledWith('user-1');
  });

  it('rejects updates for a different user id', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const { PUT } = await import('./route');

    const response = await PUT(
      new NextRequest('http://localhost/api/user/profile/user-2', {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'Bad Update' }),
      }),
      context('user-2')
    );

    expect(response.status).toBe(403);
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run 'src/app/api/user/profile/[userId]/route.test.ts' --reporter=verbose
```

Expected: FAIL because the route trusts the path `userId`.

- [ ] **Step 3: Implement identity binding**

In `src/app/api/user/profile/[userId]/route.ts`, import:

```ts
import { getAuthenticatedUserId } from '@/lib/serverAuth';
```

After parsing `userId` in both `GET` and `PUT`, add:

```ts
const authUserId = await getAuthenticatedUserId(request);
if (!authUserId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
if (authUserId !== userId) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

- [ ] **Step 4: Update route policy matrix**

Change `/api/user/profile/[userId]` to:

```markdown
| `/api/user/profile/[userId]` | `authenticated-self` | complete | `src/app/api/user/profile/[userId]/route.test.ts` |
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
npx vitest run 'src/app/api/user/profile/[userId]/route.test.ts' --reporter=verbose
```

Expected: PASS.

---

## Task 4: Lock Down Session Cookie Behavior

**Files:**

- Create: `src/app/api/auth/session/route.test.ts`
- Modify: `src/app/api/auth/session/route.ts` only if tests expose a real defect.
- Modify: `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`

- [ ] **Step 1: Add session route tests**

Create `src/app/api/auth/session/route.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdTokenMock = vi.fn();
const createSessionCookieMock = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
    createSessionCookie: createSessionCookieMock,
  },
}));

describe('/api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-1' });
    createSessionCookieMock.mockResolvedValue('session-cookie');
  });

  it('rejects missing idToken', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('creates a bounded httpOnly session cookie', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ idToken: 'id-token', expiresInDays: 99 }),
      })
    );

    expect(response.status).toBe(200);
    expect(verifyIdTokenMock).toHaveBeenCalledWith('id-token', true);
    expect(createSessionCookieMock).toHaveBeenCalledWith('id-token', {
      expiresIn: 14 * 24 * 60 * 60 * 1000,
    });
    expect(response.headers.get('set-cookie')).toContain('statly_session=session-cookie');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('clears the session cookie on delete', async () => {
    const { DELETE } = await import('./route');

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('statly_session=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
npx vitest run src/app/api/auth/session/route.test.ts --reporter=verbose
```

Expected: PASS if current session behavior is correct. If it fails, fix only the failing contract.

- [ ] **Step 3: Update route policy matrix**

Change `/api/auth/session` to:

```markdown
| `/api/auth/session` | `public` with Firebase token verification | complete | `src/app/api/auth/session/route.test.ts` |
```

---

## Task 5: Retire Or Gate Legacy Pages API Trade Routes

**Files:**

- Modify: `src/pages/api/tradeReview.ts`
- Modify: `src/pages/api/listTrades.ts`
- Create: `src/pages/api/tradeReview.test.ts`
- Create: `src/pages/api/listTrades.test.ts`
- Modify: `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md`

- [ ] **Step 1: Confirm product usage**

Run:

```bash
rg -n "(/api/tradeReview|/api/listTrades|tradeReview\\?|listTrades\\?)" src tests docs
```

Expected: no launch-critical product caller should remain. If a product caller remains, migrate that caller to the existing authenticated App Router trade APIs before gating these Pages API routes.

- [ ] **Step 2: Write failing unauthorized tests**

Create `src/pages/api/tradeReview.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(),
  },
}));

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

describe('/api/tradeReview legacy route', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
  });

  it('returns 404 outside explicit local runtime', async () => {
    const { default: handler } = await import('./tradeReview');
    const res = response();

    await handler({ method: 'POST', query: {}, body: { action: 'accept' } } as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
```

Create `src/pages/api/listTrades.test.ts` with the same `response()` helper and this assertion:

```ts
it('returns 404 outside explicit local runtime', async () => {
  const { default: handler } = await import('./listTrades');
  const res = response();

  await handler({ method: 'GET', query: {} } as never, res as never);

  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});
```

- [ ] **Step 3: Apply local-only guard**

At the start of each Pages API handler, add:

```ts
import { authorizeLocalOnlyRequest } from '@/lib/operationalAuth';

const authorization = authorizeLocalOnlyRequest();
if (!authorization.ok) {
  res.status(authorization.response.status).json({ error: 'Not found' });
  return;
}
```

- [ ] **Step 4: Update route policy matrix**

Change `/api/tradeReview` and `/api/listTrades` to `complete` with their test file evidence.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run src/pages/api/tradeReview.test.ts src/pages/api/listTrades.test.ts --reporter=verbose
```

Expected: PASS.

---

## Task 6: Prove Draft Realtime Idempotency

**Files:**

- Modify: `src/server/draft/services/DraftRealtimeDispatcher.ts`
- Modify: `src/server/draft/domain/draftTypes.ts`
- Modify: `src/contexts/DraftContext.tsx`
- Create: `src/server/draft/services/DraftRealtimeDispatcher.test.ts`
- Create: `src/contexts/DraftContext.realtime.test.tsx`

### Invariant

One logical draft event may be delivered through multiple rooms or aliases, but it must have one deterministic `eventId` and must be applied once by the client.

- [ ] **Step 1: Write failing server-side event identity test**

Create `src/server/draft/services/DraftRealtimeDispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { DraftRealtimeDispatcher } from './DraftRealtimeDispatcher';
import type { DraftPickEventPayload } from '../domain/draftTypes';

vi.mock('@/services/realtime/pubsub', () => ({
  draftPubSub: {
    publish: vi.fn(),
    start: vi.fn(),
  },
}));

function pickPayload(): DraftPickEventPayload {
  return {
    id: 'pick-1',
    overall: 1,
    round: 1,
    slot: 1,
    player: {
      id: 'player-1',
      name: 'Player One',
      position: 'MID',
      club: 'Carlton',
    },
    member: {
      id: 'member-1',
      displayName: 'Member One',
    },
    auto: false,
    madeAt: '2026-05-18T10:00:00.000Z',
    timestamp: new Date('2026-05-18T10:00:00.000Z'),
  };
}

describe('DraftRealtimeDispatcher idempotency', () => {
  it('emits the same deterministic event id to both draft rooms for one pick', async () => {
    const emissions: Array<{ room: string; event: string; payload: any }> = [];
    const io = {
      to: vi.fn((room: string) => ({
        emit: vi.fn((event: string, payload: unknown) => {
          emissions.push({ room, event, payload });
        }),
      })),
    };

    const dispatcher = new DraftRealtimeDispatcher();
    dispatcher.attachSocketServer(io as never);

    await dispatcher.publishDraftEvent('draft-1', 'draft:pick-made', pickPayload());

    const deltaEmissions = emissions.filter((item) => item.event === 'draft:delta');
    expect(deltaEmissions).toHaveLength(2);
    expect(deltaEmissions.map((item) => item.room).sort()).toEqual(['draft-1', 'draft:draft-1']);
    expect(deltaEmissions.map((item) => item.payload.eventId)).toEqual([
      'draft-1:pick:1:player-1',
      'draft-1:pick:1:player-1',
    ]);
  });
});
```

- [ ] **Step 2: Add event id to draft delta type**

In `src/server/draft/domain/draftTypes.ts`, add `eventId: string` to every `DraftRealtimeDelta` variant.

- [ ] **Step 3: Add deterministic pick event id in dispatcher**

In `src/server/draft/services/DraftRealtimeDispatcher.ts`, add:

```ts
function buildPickEventId(draftId: string, pick: DraftPickEventPayload): string {
  return `${draftId}:pick:${pick.overall}:${pick.player.id}`;
}
```

For each `PICK_MADE` delta, set:

```ts
eventId: buildPickEventId(draftId, pickPayload),
```

For non-pick deltas, create ids from stable state payload fields. These ids do not need to dedupe picks.

- [ ] **Step 4: Write failing client-side duplicate application test**

Create `src/contexts/DraftContext.realtime.test.tsx`:

```ts
import { describe, expect, it } from 'vitest';

import { applyDelta } from './DraftContext';
import type { DraftDelta, DraftState } from './DraftContext';

function baseState(): DraftState {
  return {
    draft: null,
    participants: [],
    picks: [],
    availablePlayers: [{ id: 'player-1', name: 'Player One', position: 'MID', club: 'Carlton' }],
    selectedCategories: [],
    watchlist: [],
    liveState: null,
    connection: { status: 'connected', lastEventAt: 0 },
    isSaving: false,
    isLoading: false,
    error: null,
    appliedEventIds: [],
  };
}

const pickDelta: DraftDelta = {
  type: 'PICK_MADE',
  eventId: 'draft-1:pick:1:player-1',
  ts: 1,
  payload: {
    pick: {
      id: 'pick-1',
      overall: 1,
      round: 1,
      slot: 1,
      player: { id: 'player-1', name: 'Player One', position: 'MID', club: 'Carlton' },
      member: { id: 'member-1', displayName: 'Member One' },
      auto: false,
      madeAt: '2026-05-18T10:00:00.000Z',
      timestamp: new Date('2026-05-18T10:00:00.000Z'),
    },
  },
};

describe('DraftContext realtime idempotency', () => {
  it('applies duplicate PICK_MADE realtime deltas once', () => {
    const once = applyDelta(baseState(), pickDelta);
    const twice = applyDelta(once, pickDelta);

    expect(twice.picks).toHaveLength(1);
    expect(twice.availablePlayers.map((player) => player.id)).not.toContain('player-1');
    expect(twice.appliedEventIds).toEqual(['draft-1:pick:1:player-1']);
  });
});
```

- [ ] **Step 5: Export and update client reducer**

In `src/contexts/DraftContext.tsx`, export `applyDelta`, export the `DraftState` and `DraftDelta` types if they are not already exported, and add:

```ts
appliedEventIds: string[];
```

to `DraftState` and the initial state.

At the top of `applyDelta`, add:

```ts
const eventId =
  typeof (delta as { eventId?: unknown }).eventId === 'string'
    ? (delta as { eventId: string }).eventId
    : null;

if (eventId && state.appliedEventIds.includes(eventId)) {
  return state;
}
```

When a delta changes state, carry the applied id forward:

```ts
const appliedEventIds = eventId
  ? [...next.appliedEventIds, eventId].slice(-200)
  : next.appliedEventIds;
```

Return changed state with `appliedEventIds`.

- [ ] **Step 6: Run focused realtime tests**

Run:

```bash
npx vitest run src/server/draft/services/DraftRealtimeDispatcher.test.ts src/contexts/DraftContext.realtime.test.tsx src/hooks/__tests__/useRealtimeDraft.test.ts src/components/draft/room/draftRoomViewModel.test.ts --reporter=verbose
```

Expected: PASS.

---

## Task 7: Capture Browser Workflow Evidence Without New Dependencies

**Files:**

- Create: `docs/GO_LIVE_BROWSER_SMOKE_EVIDENCE.md`

- [ ] **Step 1: Create the evidence artifact**

Create `docs/GO_LIVE_BROWSER_SMOKE_EVIDENCE.md`:

```markdown
# Go-Live Browser Smoke Evidence

Date:
Environment:
Build/branch:
Tester:

## Evidence Rules

- Record desktop and mobile viewport for each launch-critical workflow.
- Record account role used.
- Record expected and actual result.
- Record console errors and failed network requests.
- Mark workflow failed if a required control is inaccessible, hidden, unauthenticated incorrectly, or silently stale.

## Workflow Matrix

| Workflow                                       | URL | Role | Viewport | Expected                                                  | Actual | Console/network | Result  |
| ---------------------------------------------- | --- | ---- | -------- | --------------------------------------------------------- | ------ | --------------- | ------- |
| Register/login/logout/session expiry           |     |      | desktop  | User can authenticate and clear session                   |        |                 | not run |
| Dashboard first authenticated load             |     |      | desktop  | Dashboard loads selected league context                   |        |                 | not run |
| League create/join/switch                      |     |      | desktop  | League mutation succeeds and UI reflects state            |        |                 | not run |
| Draft room load/pick/queue/watchlist/reconnect |     |      | desktop  | Draft state updates once per logical event                |        |                 | not run |
| Trade proposal/review/accept/reject            |     |      | desktop  | Trade lifecycle updates permissions and state             |        |                 | not run |
| Waiver submit/cancel/process/settings          |     |      | desktop  | Waiver lifecycle respects permissions                     |        |                 | not run |
| Player detail/stats/matches/rankings           |     |      | desktop  | Canonical stats render with missing/zero semantics intact |        |                 | not run |
| Admin worker page denied without admin path    |     |      | desktop  | Non-admin browser user cannot operate workers             |        |                 | not run |
| Register/login/logout/session expiry           |     |      | mobile   | User can authenticate and clear session                   |        |                 | not run |
| Dashboard first authenticated load             |     |      | mobile   | Dashboard loads selected league context                   |        |                 | not run |
| League create/join/switch                      |     |      | mobile   | League mutation succeeds and UI reflects state            |        |                 | not run |
| Draft room load/pick/queue/watchlist/reconnect |     |      | mobile   | Draft state updates once per logical event                |        |                 | not run |
| Trade proposal/review/accept/reject            |     |      | mobile   | Trade lifecycle updates permissions and state             |        |                 | not run |
| Waiver submit/cancel/process/settings          |     |      | mobile   | Waiver lifecycle respects permissions                     |        |                 | not run |
| Player detail/stats/matches/rankings           |     |      | mobile   | Canonical stats render with missing/zero semantics intact |        |                 | not run |
| Admin worker page denied without admin path    |     |      | mobile   | Non-admin browser user cannot operate workers             |        |                 | not run |
```

- [ ] **Step 2: Run browser checks**

Use the local dev server or staging target. Fill every `not run` row with `pass` or `fail`; do not delete failed rows.

- [ ] **Step 3: Decide browser automation dependency**

If this matrix must be repeated for every release candidate, ask for approval to add Playwright. Do not add it in this task.

---

## Task 8: Make Design Guard A Release Decision

**Files:**

- Create: `docs/audits/go-live-design-drift-decision-2026-05-18.md`

- [ ] **Step 1: Capture current guard output**

Run:

```bash
npm run guard:design
```

Expected: FAIL until design drift is fixed or explicitly accepted.

- [ ] **Step 2: Create design decision artifact**

Create `docs/audits/go-live-design-drift-decision-2026-05-18.md`:

```markdown
# Go-Live Design Drift Decision

Date: 2026-05-18

## Current Guard Result

- Command: `npm run guard:design`
- Result: fail
- Active findings:
- Hard-coded palette or hex candidates:
- Legacy icon import candidates:

## Launch-Critical Surfaces

| Surface             | Files | Decision                  | Reason                              | Expiry |
| ------------------- | ----- | ------------------------- | ----------------------------------- | ------ |
| auth                |       | fix before launch         | Auth is a core workflow             |        |
| dashboard           |       | fix or explicit exception | First authenticated product surface |        |
| league              |       | fix or explicit exception | Core fantasy workflow               |        |
| draft               |       | fix or explicit exception | Core fantasy workflow               |        |
| trade               |       | fix or explicit exception | Core fantasy workflow               |        |
| waiver              |       | fix or explicit exception | Core fantasy workflow               |        |
| players             |       | fix or explicit exception | Core data browsing workflow         |        |
| admin denial states |       | fix before launch         | Security messaging must be clear    |        |

## Deferred Legacy Surfaces

| Surface | Files | Reason deferred | Expiry |
| ------- | ----- | --------------- | ------ |

## Rule

No design exception may cover a control that is inaccessible, unreadable, broken on mobile, missing focus visibility, or required to complete a launch-critical workflow.
```

- [ ] **Step 3: Update launch report**

In `docs/GO_LIVE_TEST_EXECUTION_REPORT.md`, link to this design decision artifact under the design-system gate section.

---

## Final Verification Gate

After each completed task, run the focused test for that task first.

After a batch, run:

```bash
npm run typecheck
npm run lint
npm run guard:routes
npm test
npm run branch:complete
```

After code changes, run:

```bash
npm run graphify:update
```

After UI or design changes, run:

```bash
npm run guard:design
```

`npm run guard:design` may fail only when the failure is represented in `docs/audits/go-live-design-drift-decision-2026-05-18.md` with a launch decision and expiry.

## Exit Criteria

This plan is complete only when:

- every P0 route in `docs/GO_LIVE_ROUTE_POLICY_MATRIX.md` has a non-pending status
- all local-only routes return 404 outside explicit local runtime
- user profile reads and writes are identity-bound
- session cookie behavior is tested
- legacy Pages API trade routes are retired, gated, or migrated
- draft realtime duplicate delivery is idempotent by test
- browser smoke evidence is filled with pass/fail outcomes
- design drift has either been fixed for launch-critical surfaces or accepted with documented expiry
- `npm run typecheck`, `npm run lint`, `npm run guard:routes`, `npm test`, and `npm run branch:complete` pass

---

## Self-Review

- Spec coverage: route safety, identity binding, session behavior, legacy mutable routes, realtime idempotency, browser evidence, design drift, and final release criteria are covered.
- Placeholder scan: no task uses `TBD`, `TODO`, or unnamed implementation work.
- Type consistency: shared auth naming matches `authorizeAdminRequest`, `authorizeCronRequest`, `authorizeLocalOnlyRequest`, and `getAuthenticatedUserId`.

Plan complete and saved to `docs/superpowers/plans/2026-05-18-go-live-remediation-execution-plan.md`.

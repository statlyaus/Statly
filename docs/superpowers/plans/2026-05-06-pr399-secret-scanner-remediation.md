# PR399 Secret Scanner Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #399 mergeable by removing PEM-shaped test fixtures, keeping Firebase tests isolated from real SDK/network behavior, and hardening the secret scanner without weakening incident-response guardrails.

**Architecture:** Introduce an ETL-local Firebase Admin seam so tests mock the project module instead of package-resolution paths under `node_modules`. Keep secret detection active on tracked source files and remove allowlisting for the failing test file once it no longer contains key-shaped content. Make scanner behavior explicit when git metadata is unavailable, and trim unnecessary global Node tooling from the ETL runtime image.

**Tech Stack:** TypeScript, Vitest, Next.js app repo scripts, Firebase Admin SDK, GitHub PR checks, Dockerfile multi-stage build.

---

## Investigation Summary

Current PR: `https://github.com/statlyaus/Statly/pull/399`

Evidence from PR checks:

- GitGuardian failed on `src/server/processFootywireData.test.ts` at commit `70000890d63ba9fecc32ea3b94dc4fe412682d1e`, detecting `Generic Private Key`.
- Sourcery failed on the same PEM block and also flagged `Scripts/scan-secrets.ts` because `git ls-files` is invoked unconditionally.
- Sourcery suggested removing `/usr/local/lib/node_modules` from the runtime image to reduce toolchain surface.
- GitHub Actions `prisma-migrate-and-test` jobs passed.
- Local pre-push CI passed after adding local ignored `.env.local`.

The best long-term fix is not to suppress GitGuardian or add more broad allowlists. The fix is to remove key-shaped data from source, create a stable Firebase Admin test seam, and keep the scanners strict.

## File Structure

- Create `etl/firebaseAdmin.ts`
  - One responsibility: wrap the `firebase-admin` package for ETL code so production imports stay simple and tests can mock a repo-owned module.
- Modify `etl/processFootywireData.ts`
  - Replace direct `firebase-admin` package import with the ETL wrapper.
- Modify `src/server/processFootywireData.test.ts`
  - Mock `../../etl/firebaseAdmin` only.
  - Remove the generated PEM fixture entirely.
  - Use a non-secret placeholder private key because the wrapper mock prevents Firebase Admin from parsing credentials in this unit test.
- Modify `Scripts/scan-secrets.ts`
  - Catch `git ls-files` failures and return an empty tracked-file list with a warning.
  - Remove `src/server/processFootywireData.test.ts` from the allowlist after removing PEM-shaped content.
- Modify `etl/Dockerfile`
  - Stop copying global Node package tooling into the final runtime image.
  - Copy only the `node` binary because the runtime container executes compiled JavaScript directly.

---

### Task 1: Add an ETL Firebase Admin Seam

**Files:**

- Create: `etl/firebaseAdmin.ts`
- Modify: `etl/processFootywireData.ts`
- Test: `src/server/processFootywireData.test.ts`

- [ ] **Step 1: Create the wrapper module**

Create `etl/firebaseAdmin.ts` with this exact content:

```ts
import * as admin from 'firebase-admin';

export const apps = admin.apps;
export const credential = admin.credential;
export const firestore = admin.firestore;
export const initializeApp = admin.initializeApp;
```

- [ ] **Step 2: Use the wrapper in ETL code**

In `etl/processFootywireData.ts`, replace:

```ts
import * as admin from 'firebase-admin';
```

with:

```ts
import * as admin from './firebaseAdmin';
```

- [ ] **Step 3: Run the focused test to expose current fixture/scanner state**

Run:

```bash
npx vitest run src/server/processFootywireData.test.ts
```

Expected before Task 2 is complete:

```text
✓ src/server/processFootywireData.test.ts
```

If this fails with a real Firestore network call, the wrapper mock in Task 2 is not wired correctly.

---

### Task 2: Remove PEM-Shaped Test Fixtures

**Files:**

- Modify: `src/server/processFootywireData.test.ts`
- Test: `src/server/processFootywireData.test.ts`

- [ ] **Step 1: Replace the Firebase Admin mocks**

In `src/server/processFootywireData.test.ts`, replace the current `firebaseAdminMock` block and both `vi.mock('firebase-admin', ...)` calls with this block:

```ts
const firebaseAdminModuleMock = vi.hoisted(() => ({
  apps: [],
  initializeApp: vi.fn(),
  credential: {
    cert: vi.fn(),
  },
  firestore: Object.assign(
    vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === 'matches') {
          return {
            doc: vi.fn(() => ({
              get: firestoreMatchDocGet,
            })),
            where: vi.fn(() => ({
              where: vi.fn(() => ({
                get: firestoreMatchesGet,
              })),
            })),
          };
        }

        return {
          doc: vi.fn(() => ({
            get: firestoreStatDocGet,
            set: firestoreDocSet,
            delete: firestoreDocDelete,
          })),
        };
      }),
    })),
    {
      FieldValue: {
        serverTimestamp: vi.fn(() => 'server-timestamp'),
      },
    }
  ),
}));

vi.mock('../../etl/firebaseAdmin', () => firebaseAdminModuleMock);
```

- [ ] **Step 2: Delete the PEM fixture**

Remove the entire `TEST_PRIVATE_KEY` constant from `src/server/processFootywireData.test.ts`.

- [ ] **Step 3: Use a non-secret placeholder credential**

In the `beforeEach` block, replace:

```ts
private_key: `${TEST_PRIVATE_KEY}\\n`,
```

with:

```ts
private_key: 'unit-test-private-key-placeholder',
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run src/server/processFootywireData.test.ts
```

Expected:

```text
Test Files  1 passed (1)
Tests  4 passed (4)
```

- [ ] **Step 5: Run the secret guard**

Run:

```bash
npm run guard:secrets
```

Expected:

```text
no secret-like content detected
```

This should pass without allowlisting `src/server/processFootywireData.test.ts`.

---

### Task 3: Make the Secret Scanner Robust Outside Git Contexts

**Files:**

- Modify: `Scripts/scan-secrets.ts`
- Test: `npm run guard:secrets`

- [ ] **Step 1: Update imports**

Keep:

```ts
import { execFileSync } from 'node:child_process';
```

No new dependency is needed.

- [ ] **Step 2: Remove the test file from the allowlist**

In `TRACKED_SCAN_ALLOWLIST`, remove:

```ts
'src/server/processFootywireData.test.ts',
```

The allowlist should remain limited to explicit docs/examples/tests that intentionally validate service-account parsing:

```ts
const TRACKED_SCAN_ALLOWLIST = new Set([
  '.env.example',
  'secrets/serviceAccountKey.example.json',
  'src/lib/env.spec.ts',
  'src/lib/serviceAccount.test.ts',
]);
```

- [ ] **Step 3: Wrap git enumeration**

Replace `getTrackedFiles()` with:

```ts
function getTrackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
      .split('\0')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((file) => !TRACKED_SCAN_ALLOWLIST.has(file));
  } catch (error) {
    console.warn('Unable to enumerate git-tracked files for secret scanning.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
```

- [ ] **Step 4: Run the guard**

Run:

```bash
npm run guard:secrets
```

Expected:

```text
Scanned 2 build files and 2165 tracked files; no secret-like content detected.
```

The exact tracked-file count may differ by one after file additions, but the command must exit `0`.

---

### Task 4: Trim the ETL Runtime Image Tooling Surface

**Files:**

- Modify: `etl/Dockerfile`
- Test: `npm --prefix etl run build`

- [ ] **Step 1: Remove global Node modules copy**

In `etl/Dockerfile`, replace:

```dockerfile
# Copy Node.js runtime from the official LTS image.
COPY --from=node-stage /usr/local/bin/node /usr/local/bin/node
COPY --from=node-stage /usr/local/bin/npm /usr/local/bin/npm
COPY --from=node-stage /usr/local/bin/npx /usr/local/bin/npx
COPY --from=node-stage /usr/local/lib/node_modules /usr/local/lib/node_modules
```

with:

```dockerfile
# Copy the Node.js runtime from the official LTS image.
COPY --from=node-stage /usr/local/bin/node /usr/local/bin/node
```

- [ ] **Step 2: Run the ETL build**

Run:

```bash
npm --prefix etl run build
```

Expected:

```text
> statly-etl@1.0.0 build
> tsc
```

Exit code must be `0`.

- [ ] **Step 3: Record Docker verification gap**

Because Docker is unavailable in this local environment, do not claim image verification. Keep this note in the PR update:

```text
Docker image build/smoke test still needs to run in an environment with Docker:
npm --prefix etl run docker-build
docker run --rm statly-etl node --version
docker run --rm statly-etl Rscript -e "library(fitzRoy); library(jsonlite); library(janitor); library(dplyr); library(stringr)"
```

---

### Task 5: Verify, Amend, Push, and Re-check PR

**Files:**

- Modify: existing staged branch only
- Test: full repo verification

- [ ] **Step 1: Run focused checks**

Run:

```bash
npx vitest run src/server/processFootywireData.test.ts
npm run guard:secrets
npm --prefix etl run build
```

Expected:

```text
processFootywireData.test.ts: 4 passed
guard:secrets: no secret-like content detected
etl build: exit 0
```

- [ ] **Step 2: Run full checks**

Run:

```bash
npm run typecheck:app
npm run typecheck:tests
npm run lint
npm run guard:tracked-artifacts
npm run guard:secrets
npm test
npm run format:check
git diff --check
```

Expected:

```text
All commands exit 0.
npm test reports 80 passed test files and 363 passed tests, unless unrelated tests have changed.
```

- [ ] **Step 3: Amend the existing PR commit**

Run:

```bash
git add -A
git commit --amend --no-edit
```

Expected:

```text
[codex/security-secret-docker-remediation <new-sha>] Harden secret and ETL Docker guardrails
```

- [ ] **Step 4: Push the amended branch**

Run:

```bash
git push --force-with-lease origin codex/security-secret-docker-remediation
```

Expected:

```text
codex/security-secret-docker-remediation -> codex/security-secret-docker-remediation
```

- [ ] **Step 5: Check PR status**

Run:

```bash
gh pr checks 399
gh pr view 399 --json mergeStateStatus,mergeable,statusCheckRollup
```

Expected:

```text
GitGuardian Security Checks no longer reports the Generic Private Key in src/server/processFootywireData.test.ts.
Sourcery no longer reports the PEM fixture or git ls-files issue.
GitHub Actions remain passing.
```

If GitGuardian still reports the older commit SHA, wait for the new scan to complete before changing code again.

---

## Self-Review

Spec coverage:

- Removes the scanner-triggering private key fixture: Task 2.
- Keeps Firebase tests isolated from the real SDK and local `etl/node_modules`: Tasks 1 and 2.
- Keeps secret scanning strict instead of allowlisting the failing test file: Task 3.
- Handles Sourcery robustness issue for `git ls-files`: Task 3.
- Handles Docker image surface feedback: Task 4.
- Preserves full verification and PR re-check workflow: Task 5.

Placeholder scan:

- No `TBD`, `TODO`, “implement later”, or vague “add appropriate handling” steps remain.
- Each code-changing step includes exact replacement content.

Type consistency:

- `firebaseAdminModuleMock` is defined once and used by `vi.mock('../../etl/firebaseAdmin', ...)`.
- The ETL import path is `./firebaseAdmin`, matching the new `etl/firebaseAdmin.ts` file.
- `getTrackedFiles()` still returns `string[]`, preserving caller behavior.

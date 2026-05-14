# Shadcn UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate touched product UI surfaces toward Statly's shadcn-style primitives, semantic tokens, and accessible component composition.

**Architecture:** Use existing open-code primitives in `src/components/ui/`, `cn` from `src/lib/utils.ts`, semantic Tailwind tokens from `src/index.css`, and lucide icons. Keep this PR visual-only except for accessibility improvements required by the UI migration.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, shadcn New York style, lucide-react, Vitest where component tests exist.

---

## Scope

This PR must not modify ETL, Firestore contracts, Prisma migrations, dependency governance, or read-model API behavior.

## Files

- Modify: `src/components/ui/Alert.tsx`
- Modify: `src/components/ui/Badge.tsx`
- Modify: `src/components/ui/DataTable.tsx`
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/components/ui/LoadingSpinner.tsx`
- Modify: `src/components/ui/NotificationCenter.tsx`
- Modify selected product surfaces only after primitive tests pass.

## Task 1: UI Primitive Token Pass

- [ ] **Step 1: Replace Heroicons in primitives**

In `src/components/ui/Alert.tsx` and `src/components/ui/Badge.tsx`, use lucide icons:

```ts
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react';
```

```ts
import { X } from 'lucide-react';
```

- [ ] **Step 2: Replace hard-coded palette classes with semantic tokens**

Use classes such as:

```ts
'border-border bg-muted text-muted-foreground'
'border-destructive bg-destructive text-destructive-foreground'
'focus-visible:ring-ring'
```

Do not add hex, rgb, oklch, or arbitrary colors in component markup.

- [ ] **Step 3: Verify primitives compile**

Run:

```bash
npm run typecheck
```

Expected: typecheck passes in the isolated UI branch.

## Task 2: Accessibility Pass

- [ ] **Step 1: Verify icon-only buttons**

Every icon-only dismiss/action button must have an accessible name:

```tsx
<button aria-label="Dismiss alert" type="button">
```

- [ ] **Step 2: Preserve focus visibility**

Use:

```ts
'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
```

- [ ] **Step 3: Verify with lint/typecheck**

Run:

```bash
npm run typecheck
git diff --check
```

Expected: both pass.

## Task 3: One Product Surface Migration

- [ ] **Step 1: Choose one surface**

Pick one surface from the changed files, preferably `src/app/players/PlayersPageClient.tsx`, because it is a data-heavy fantasy workflow.

- [ ] **Step 2: Replace raw controls only where local and reviewable**

Use existing `UIButton`, `UIInput`, `UISelect`, table primitives, semantic tokens, and lucide icons. Do not rewrite layout wholesale.

- [ ] **Step 3: Browser verification**

Run the app and verify the selected page at desktop and mobile width.

Expected:
- no text overlap
- keyboard focus visible on changed controls
- loading/empty/error states still render

## Final Verification

Run:

```bash
npm run typecheck
git diff --check
```

If browser verification is practical, include the local URL and the viewports checked in the PR description.

## Self-Review

- Scope is UI-only.
- shadcn guidance is explicit: open primitives, semantic tokens, lucide icons, no new dependency.
- Data behavior changes are excluded.

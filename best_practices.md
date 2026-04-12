# 📘 Statly Project Best Practices

## 1. Project Purpose

Statly is a comprehensive fantasy sports platform for the Australian Football League (AFL), built with Next.js 15, React 19, TypeScript, and Firebase. The platform features real-time player statistics, live scoring, snake draft systems, waiver/FAAB management, and league administration tools. It includes a sophisticated ETL pipeline for ingesting live AFL data from multiple sources (Footywire, AFL Official) with 30-second polling during live matches. The application supports multiple leagues, real-time draft rooms with Socket.IO, advanced player analytics, and a modular dashboard system.

## 2. Project Structure

### Core Directories

```
src/
├── app/                    # Next.js 15 App Router pages (RSC by default)
│   ├── (auth)/            # Auth routes (login, register, forgot-password)
│   ├── api/               # API route handlers (server-only)
│   ├── drafts/            # Draft-related pages
│   ├── leagues/           # League management pages
│   └── [feature]/         # Feature-specific pages
├── components/            # React components (mostly client components)
│   ├── ui/               # Reusable UI primitives (Alert, Badge, Modal, etc.)
│   ├── advanced/         # Advanced features (RealTimeMatchCenter, etc.)
│   ├── draft/            # Draft-specific components
│   ├── league/           # League-specific components
│   ├── navigation/       # Navigation components (AppLayout, MainNavigation)
│   └── [feature]/        # Feature-grouped components
├── contexts/             # React Context providers (Auth, Draft, Socket, Team)
├── hooks/                # Custom React hooks
├── lib/                  # Shared utilities and configurations
│   ├── firebaseAdmin.ts  # Server-only Firebase Admin SDK
│   ├── firebaseClient.ts # Client-side Firebase SDK
│   ├── logger.ts         # Structured logging utility
│   ├── api.ts            # API client utilities (fetchApi, fetchJson)
│   └── [utility].ts      # Domain-specific utilities
├── server/               # Server-only code (Socket.IO, workers, queues)
│   ├── realtime/         # Real-time pub/sub infrastructure
│   ├── workers/          # Background workers (draft, web vitals)
│   └── queue/            # BullMQ job queues
├── services/             # Business logic services (can be used client/server)
├── state/                # Zustand stores for client state
├── types/                # TypeScript type definitions (types-only, no values)
└── utils/                # General utility functions

dataconnect/              # Firebase Data Connect schema
etl/                      # ETL pipeline (Python/TypeScript)
functions/                # Firebase Cloud Functions
Scripts/                  # Utility scripts (seeding, migration, validation)
prisma/                   # Prisma schema (if used)
```

### Key Conventions

- **App Router**: All pages use Next.js 15 App Router with React Server Components (RSC) by default
- **Client Components**: Marked with `'use client'` directive at the top of the file
- **Server-Only Code**: Protected with `import 'server-only'` (e.g., `firebaseAdmin.ts`)
- **Path Aliases**: Use `@/` for `src/`, `@server/` for `src/server/`, `@contexts/` for `src/contexts/`
- **Page Structure**: Server Component pages (`page.tsx`) often delegate to Client Components (`*Client.tsx`)

## 3. Test Strategy

### Framework

- **Test Runner**: Vitest (configured in `package.json`)
- **Testing Library**: `@testing-library/react` for component tests
- **DOM Environment**: jsdom for browser simulation

### Test Organization

```
src/
├── __tests__/                    # Top-level test utilities
├── [feature]/__tests__/          # Feature-specific tests
├── [file].test.ts                # Co-located unit tests
└── [file].spec.ts                # Alternative test extension
```

### Naming Conventions

- Unit tests: `[filename].test.ts` or `[filename].spec.ts`
- Accessibility tests: `[filename].a11y.test.tsx`
- Test files mirror source structure

### Testing Patterns

- **Mocking**: Use Vitest's `vi.mock()` for module mocking
- **Hooks Testing**: Use `@testing-library/react-hooks` or `renderHook` from `@testing-library/react`
- **Accessibility**: Dedicated `.a11y.test.tsx` files for accessibility validation
- **Coverage**: Run with `npm test` (Vitest)

### Test Commands

```bash
npm test                    # Run all tests
npm run typecheck:tests     # Type-check test files
npm run pretest             # Runs typecheck before tests
```

## 4. Code Style

### TypeScript

- **Strict Mode**: Enabled (`strict: true` in `tsconfig.json`)
- **Target**: ES2022
- **Module Resolution**: `bundler` (Next.js 15 compatible)
- **Type Imports**: Prefer `import type` for type-only imports
- **Explicit Return Types**: Required on exported functions (`@typescript-eslint/explicit-module-boundary-types`)

### Naming Conventions

- **Files**:
  - Components: PascalCase (e.g., `PlayerCard.tsx`)
  - Utilities: camelCase (e.g., `firebaseAdmin.ts`)
  - Types: camelCase (e.g., `players.ts`)
  - Client pages: `*Client.tsx` suffix
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for true constants, camelCase for config objects
- **Types/Interfaces**: PascalCase
- **Functions**: camelCase
- **React Components**: PascalCase

### Async/Await

- Prefer `async/await` over `.then()` chains
- Always handle errors with try/catch or error boundaries
- Use `Promise.all()` for parallel operations
- Check for `isAbortError()` when handling fetch errors

### Error Handling

- **Client**: Use Error Boundaries (`ErrorBoundary`, `PageErrorBoundary`)
- **Server**: Return proper HTTP status codes with error messages
- **Logging**: Use structured logger (`logger.error()`, `logger.warn()`)
- **Abort Errors**: Check `isAbortError(error)` before logging fetch failures

### Comments & Documentation

- Use JSDoc for exported functions and complex logic
- Inline comments for non-obvious code
- Type definitions include descriptive comments
- README files for major subsystems (e.g., `etl/README.md`)

### Import Organization

ESLint enforces import order:

1. React/Next.js (external, before other externals)
2. External packages
3. Internal aliases (`@/`, `@server/`, `@contexts/`)
4. Relative imports (parent, sibling, index)
5. Type imports (last)

Newlines between groups are required.

## 5. Common Patterns

### Client/Server Separation

```typescript
// Server Component (default in app/)
import { adminDb } from '@/lib/firebaseAdmin';

export default async function Page() {
  const data = await adminDb.collection('players').get();
  return <ClientComponent data={data} />;
}

// Client Component
'use client';
import { useState } from 'react';

export function ClientComponent({ data }) {
  const [state, setState] = useState(data);
  // ...
}
```

### Firebase Usage

```typescript
// Server-side (API routes, RSC)
import { adminDb, adminAuth } from '@/lib/firebaseAdmin';

// Client-side (hooks, components)
import { db, auth } from '@/lib/firebaseClient';
```

### API Client Pattern

```typescript
import { fetchApi, fetchJson } from '@/lib/api';

// With error handling
const data = await fetchJson<PlayerStats[]>('/api/player-stats', {
  signal: abortController.signal,
});

// With pagination
const players = await fetchAllPages<Player>('/api/players', { limit: 100 });
```

### Logging Pattern

```typescript
import { logger } from '@/lib/logger';

// Structured logging
logger.info('Draft started', { draftId, userId });
logger.error('Failed to fetch players', error, { endpoint: '/api/players' });

// Performance logging
logger.performanceWarn('fetchPlayers', duration, 1000);

// Lightweight structured logs (server-side)
import { info, warn, error, time, timeEnd } from '@/lib/logger';

time('operation');
info('Starting operation', { userId });
// ... do work
timeEnd('operation', 'Operation complete');
```

### State Management

- **Global State**: Zustand stores in `src/state/` (e.g., `tradeStore.tsx`)
- **Server State**: React Query (`@tanstack/react-query`) or SWR
- **Context**: React Context for auth, draft, socket connections
- **Local State**: `useState` for component-local state

### Real-time Patterns

```typescript
// Socket.IO client
import { joinDraft, emitPick } from '@/client/socket';

// Pub/Sub (server-side)
import { draftPubSub } from '@/services/realtime/pubsub';
await draftPubSub.publish('draft:pick', { draftId, pick });
```

### Type Validation

```typescript
import { validatePlayer } from '@/lib/playerValidation';

const player = validatePlayer(rawData); // Returns validated Player or null
```

### Emulator Support

```typescript
// Automatically connects to emulators in development
// Set environment variables:
// FIRESTORE_EMULATOR_HOST=localhost:8080
// FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
// NEXT_PUBLIC_USE_EMULATORS=true
```

## 6. Do's and Don'ts

### ✅ Do's

- **Always** use `'use client'` directive for components with hooks, state, or browser APIs
- **Always** use `import 'server-only'` in files that should never run in the browser
- **Always** use path aliases (`@/`, `@server/`) instead of relative imports for cross-directory imports
- **Always** handle loading and error states in components
- **Always** use TypeScript strict mode and fix type errors
- **Always** validate environment variables before use (see `src/lib/env.ts`)
- **Always** use structured logging (`logger.*`) instead of `console.log`
- **Always** check `isAbortError()` before logging fetch failures
- **Always** use Error Boundaries for client components
- **Always** return proper HTTP status codes from API routes
- **Always** use `adminDb`/`adminAuth` on the server, `db`/`auth` on the client
- **Always** sanitize and validate user input
- **Always** use `fetchApi` or `fetchJson` for API calls (includes error handling)
- **Always** include accessibility attributes (ARIA labels, roles, semantic HTML)
- **Always** test with Firebase emulators before deploying

### ❌ Don'ts

- **Never** import `@server/*` or `firebaseAdmin` in client components
- **Never** import client-only code (`components/`, `contexts/`) in server code
- **Never** commit secrets or service account keys (use environment variables)
- **Never** use `console.log` in production code (use `logger.*`)
- **Never** ignore TypeScript errors or use `@ts-ignore` without explanation
- **Never** fetch data in client components without error handling
- **Never** use `any` type without a comment explaining why
- **Never** mutate props or state directly
- **Never** forget to clean up subscriptions, timers, or listeners
- **Never** use `window` or `document` without checking `typeof window !== 'undefined'`
- **Never** hardcode API URLs (use relative paths or `NEXT_PUBLIC_API_BASE_URL`)
- **Never** expose Firebase Admin SDK credentials to the client
- **Never** skip input validation on API routes
- **Never** use `getServerSideProps` or `getStaticProps` (use App Router patterns)

## 7. Tools & Dependencies

### Core Stack

- **Framework**: Next.js 15.5.3 (App Router, Turbopack)
- **React**: 19.1.1
- **TypeScript**: 5.9.2
- **Styling**: Tailwind CSS 4.1.13 + DaisyUI 5.1.10
- **Database**: Firebase Firestore + Firebase Auth
- **Real-time**: Socket.IO 4.8.1 + Redis (ioredis 5.7.0)
- **State**: Zustand 5.0.8 + React Query 5.87.4
- **Forms**: Native React state (no form library)
- **Animation**: Framer Motion 12.23.12
- **Icons**: Heroicons 2.2.0 + Lucide React 0.544.0

### Development Tools

- **Linting**: ESLint 9.35.0 (flat config)
- **Formatting**: Prettier 3.6.2
- **Testing**: Vitest 3.2.4 + Testing Library
- **Type Checking**: TypeScript strict mode
- **Package Manager**: npm

### Key Libraries

- **Data Fetching**: Axios 1.11.0, SWR 2.3.6
- **Date Handling**: date-fns 4.1.0 + date-fns-tz 3.2.0
- **Validation**: Zod 4.1.8
- **Drag & Drop**: @hello-pangea/dnd 18.0.1
- **Charts**: Chart.js 4.5.0 + react-chartjs-2 5.3.0
- **Background Jobs**: BullMQ 5.58.5
- **Web Scraping**: Cheerio 1.1.2 (ETL pipeline)

### Firebase Setup

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize project
firebase init

# Start emulators
npm run emu

# Deploy
firebase deploy
```

### Environment Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Validate environment
npm run env:check

# Start development server
npm run dev

# Start with emulators
npm run dev:emu

# Start with Socket.IO server
npm run dev:full
```

### Scripts

```bash
# Development
npm run dev                 # Next.js dev server (Turbopack)
npm run dev:full            # Next.js + Socket.IO
npm run dev:emu             # Next.js + Firebase emulators

# Build & Deploy
npm run build               # Production build
npm start                   # Production server

# Code Quality
npm run lint                # ESLint
npm run format              # Prettier format
npm run format:check        # Prettier check
npm run typecheck           # TypeScript check (all configs)

# Testing
npm test                    # Run Vitest tests

# Database
npm run emu                 # Start Firebase emulators
npm run init-firebase-db    # Initialize Firebase database
npm run seed:auth           # Seed auth users

# Guards (pre-push checks)
npm run setup:hooks         # Re-apply: git uses versioned hooks in .githooks/ (also runs automatically via npm `prepare` after `npm install` when `.git` exists; skipped when `CI=true` or `--ignore-scripts`)
npm run prepush             # CI-aligned: typecheck, lint, Firebase env file check, guards, tests, format
npm run prepush:full        # Stricter: full env:check (bash + node env report) before the same gates as prepush
npm run doctor              # Alias for prepush (local “is my tree healthy?”)
npm run guard:routes        # Check route runtime config
npm run guard:secrets       # Scan for secrets
npm run guard:deps          # Check server/client imports
```

CI on `main` also runs `npm run build` and (on push) `npm audit`; those are intentionally omitted from `prepush:ci` / the pre-push hook to keep local pushes reasonably fast.

## 8. Other Notes

### For LLMs Generating Code

1. **Server vs Client**: Always determine if code runs on server or client first
   - Server: API routes, RSC, Firebase Admin SDK, database queries
   - Client: Hooks, state, browser APIs, Firebase Client SDK

2. **Import Paths**: Use path aliases consistently
   - `@/` for `src/`
   - `@server/` for `src/server/`
   - `@contexts/` for `src/contexts/`

3. **Type Safety**: This project uses strict TypeScript
   - All functions should have explicit return types
   - Avoid `any` unless absolutely necessary
   - Use `type` imports for type-only imports

4. **Error Handling**: Every async operation needs error handling
   - Client: Error boundaries + try/catch
   - Server: HTTP status codes + structured errors
   - Always check `isAbortError()` for fetch errors

5. **Firebase Patterns**:
   - Server: `adminDb`, `adminAuth` from `@/lib/firebaseAdmin`
   - Client: `db`, `auth` from `@/lib/firebaseClient`
   - Emulators: Automatically connected in development

6. **Real-time Features**: Use Socket.IO for draft rooms, pub/sub for server events
   - Client: `joinDraft()`, `emitPick()` from `@/client/socket`
   - Server: `draftPubSub.publish()` from `@/services/realtime/pubsub`

7. **Logging**: Use structured logger, not console
   - `logger.info()`, `logger.error()`, `logger.warn()`
   - Include context objects for debugging
   - Performance logging with `logger.performanceWarn()`

8. **API Routes**: Follow Next.js 15 App Router conventions
   - Export named functions: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
   - Return `NextResponse.json()` with proper status codes
   - Validate input with Zod or manual validation
   - Use `getAuthenticatedUserId()` for protected routes

9. **Styling**: Tailwind CSS with custom AFL team themes
   - Use utility classes, not custom CSS
   - DaisyUI components available
   - Team colors in `@/lib/teamTokens`

10. **Performance**:
    - Use React Server Components by default
    - Minimize client-side JavaScript
    - Lazy load heavy components with `dynamic()`
    - Monitor with `logger.performanceWarn()`

11. **Accessibility**:
    - Use semantic HTML
    - Include ARIA labels and roles
    - Test with keyboard navigation
    - Dedicated `.a11y.test.tsx` files

12. **ETL Pipeline**: Python/TypeScript hybrid
    - Python: Data fetching (Footywire scraper)
    - TypeScript: Data ingestion (Firestore)
    - 30-second polling during live matches
    - NDJSON intermediate format

13. **Draft System**: Real-time snake draft with Socket.IO
    - Server: `liveDraftEngine` manages state
    - Client: `useLiveDraft` hook for UI
    - Persistence: Firestore + Redis
    - Queue: BullMQ for scheduled drafts

14. **League Isolation**: Each league has isolated data
    - Collections: `leagues/{leagueId}/...`
    - Membership: `leagueMembers` collection
    - Validation: `assertLeagueMember()` middleware

15. **Session Management**: HTTP-only cookies
    - Client: Sign in with Firebase SDK
    - Server: Verify session cookie with Admin SDK
    - Endpoint: `POST /api/auth/session`

### Edge Cases & Constraints

- **Player Names**: Handle parsing from multiple formats (ETL, legacy, simple)
- **Timezones**: Use `date-fns-tz` for AFL match times (Australia/Melbourne)
- **Emulator Hosts**: Prefer private vars (`FIRESTORE_EMULATOR_HOST`) over public
- **Rate Limiting**: Redis-based when available, in-memory fallback
- **Duplicate Prevention**: De-duplication for web vitals and analytics
- **Abort Signals**: Always pass `signal` to fetch calls for cancellation
- **Firestore Pagination**: Use cursors, not offset-based pagination
- **Snake Draft**: Alternating direction per round (forward/reverse)
- **FAAB System**: Budget-based waiver claims with priority queue
- **Nine-Category Rankings**: Z-score normalization with winsorization

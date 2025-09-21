# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development Commands

### Core Development
```bash
# Start development server with Turbopack
npm run dev

# Start development with full stack (app + socket)
npm run dev:full

# Start development with all services (app + socket + worker)
npm run dev:full:all

# Build production version
npm run build

# Start production server
npm run start
```

### Testing & Quality Assurance
```bash
# Run all tests
npm run test

# Type checking (app and tests)
npm run typecheck

# Lint codebase
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check

# Pre-push validation (runs lint, typecheck, env checks, guards)
npm run prepush
```

### Firebase Development
```bash
# Start Firebase emulators with data import/export
npm run emu

# Start emulators once (no export on exit)
npm run emu:once

# Clean emulator data
npm run emu:clean

# Open emulator UI
npm run emu:ui

# Development with emulators
npm run dev:emu

# Full development with emulators (app + socket + emulators)
npm run dev:full:emu
```

### Environment & Database
```bash
# Check environment variables
npm run env:check

# Validate environment configuration
npm run env:validate

# Initialize Firebase database
npm run init-firebase-db

# Check database connection
npm run db:check

# Run Firestore smoke tests
npm run firestore:smoke

# Check ETL setup
npm run check:etl
```

### ETL Pipeline
```bash
# Navigate to ETL directory
cd etl/

# Install ETL dependencies
npm install

# Build ETL TypeScript
npm run build

# Run ETL development server
npm run dev

# Test R data fetcher
npm run test-r

# Test full pipeline
npm run test-pipeline

# Validate match data
npm run validate
```

### Single Test Execution
```bash
# Run specific test file with Vitest
npx vitest run path/to/test.spec.ts

# Run tests in watch mode
npx vitest

# Run tests with UI
npx vitest --ui
```

## Architecture Overview

### High-Level Structure
Statly is a comprehensive fantasy AFL platform built as a full-stack Next.js application with real-time capabilities:

- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS with DaisyUI components and AFL team theming
- **Backend**: Firebase (Firestore, Authentication, Functions)
- **Real-time**: Socket.IO for live drafts and scoring
- **Data Pipeline**: Custom ETL using R (fitzRoy) and TypeScript
- **Infrastructure**: Vercel (frontend), Google Cloud Run (ETL)

### Key Directories

#### `/src/app/` - Next.js App Router
- **Route-based pages**: Each directory represents a route (dashboard, drafts, leagues, etc.)
- **Client components**: Each page has a corresponding `*Client.tsx` for client-side logic
- **API routes**: `/src/app/api/` contains all backend API endpoints
- **Layout system**: Root `layout.tsx` with universal navigation tabs

#### `/src/components/` - Reusable UI Components  
- **Form components**: `Form.tsx`, `FormField.tsx`, `Button.tsx`
- **Fantasy-specific**: `AvailablePlayersTable.tsx`, `DraftBanner.tsx`, `LeagueDashboard.tsx`
- **Real-time**: `LivePickHeader.tsx`, `CountdownTimer.tsx`
- **Layout**: `AuthHeader.tsx`, `ErrorBoundary.tsx`

#### `/src/lib/` - Core Business Logic
- **Firebase**: `firebaseClient.ts` (client), `firebaseAdmin.ts` (server-only)
- **Configuration**: `config.ts`, `environment.ts` (typed environment variables)
- **Data access**: `api.ts`, `data.ts`, `cache.ts`, `cacheTags.ts`
- **Fantasy logic**: `draftLobby.ts`, `draftReducer.ts`, `leagueMembership.ts`
- **ETL integration**: `etlIntegration.ts`, `etlIntegration-admin.ts`

#### `/etl/` - Real-time Data Pipeline
- **R scripts**: `fetch_fw_round.R` (fitzRoy data fetcher)
- **TypeScript processors**: `processFootywireData.ts`, `liveGuard.ts`
- **Validation**: `validateMatchData.ts`
- **Independent package**: Has its own `package.json` and build process

#### `/functions/` - Firebase Cloud Functions
- **Serverless functions**: League management, notifications
- **Independent deployment**: Separate TypeScript project

### Data Architecture

#### Firebase Firestore Collections
- **matches/{matchUid}**: Match details and status (format: `2025-R18-ADE-COL`)  
- **players/{playerUid}**: Player profiles and team affiliations (format: `ply_rory_laird`)
- **player_match_stats/{matchUid}_{playerUid}**: Real-time player statistics during matches
- **leagues/**: Fantasy league configurations and settings
- **leagueMembers/**: User memberships and team assignments
- **drafts/**: Draft room metadata and pick sequences

#### ETL Data Flow
```
R (fitzRoy) → NDJSON → TypeScript Processor → Firestore → Next.js API → React Hooks
```

### Authentication & Security

#### Session-Based Auth Flow
1. Client authenticates with Firebase Web SDK
2. Client posts `idToken` to `/api/auth/session`  
3. Server validates token and sets `statly_session` HTTP-only cookie
4. Protected routes verify session cookie with Firebase Admin SDK

#### Environment Variable Structure
- **Public variables**: `NEXT_PUBLIC_*` for client-side configuration
- **Server variables**: Firebase Admin SDK, API keys, database URLs
- **Emulator support**: Separate variables for local development vs production

### Real-time Features

#### Socket.IO Integration
- **Draft system**: Real-time pick notifications and turn management
- **Live scoring**: Player stat updates during AFL matches  
- **League activity**: Trade notifications, waiver claims, commissioner actions

#### Data Synchronization
- **Client hooks**: `useLivePlayerStats`, `useDraftSocket`, `useLeagueUpdates`
- **Server events**: ETL pipeline pushes updates via Firebase → Socket.IO
- **Optimistic updates**: Client state updates before server confirmation

## Important Configuration

### ESLint Rules
- **Import restrictions**: Prevents client code from importing server-only modules
- **Type-only imports**: Enforces `import type` for TypeScript types  
- **Server/client boundaries**: Strict separation between Firebase Admin/Client SDKs

### TypeScript Configuration
- **Multiple tsconfig files**: `tsconfig.app.json`, `tsconfig.test.json`, `tsconfig.worker.json`
- **Path mapping**: `@/` prefix for clean imports from `src/`
- **Strict mode enabled**: Full type safety with strict TypeScript settings

### Design Standards (from CLAUDE.md)
- **Inspiration**: Combines ESPN Fantasy's structure, SuperCoach's AFL depth, Yahoo Fantasy's UX
- **Accessibility**: WCAG 2.1 AA compliance required
- **Performance**: <2s load time on 4G, optimized images, virtualized tables
- **Mobile-first**: Responsive design for phone and desktop fantasy management

## Development Workflow

### Client/Server Architecture
- **Server-only code**: `/src/lib/firebaseAdmin.ts`, `/src/app/api/`, `/Scripts/`
- **Client code**: `/src/components/`, `/src/hooks/`, page components
- **Shared types**: `/src/types/` (types-only, no runtime exports)

### Firebase Emulator Development
- **Emulator hosts**: Separate public/private environment variables for client/server
- **Data persistence**: Import/export emulator data for consistent development
- **Admin SDK**: Uses environment variables to connect to emulators automatically

### Git Workflow
- **Pre-push hooks**: Runs linting, type checking, environment validation, and security guards
- **Environment checks**: Validates Firebase configuration and prevents secret exposure
- **Route guards**: Ensures proper Next.js runtime configuration for API routes
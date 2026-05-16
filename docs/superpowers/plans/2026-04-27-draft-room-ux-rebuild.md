# Draft Room UX Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the live fantasy draft room into a durable, board-first Statly workspace that matches the rest of the app, makes queue/autopick behavior explicit, protects realtime draft correctness, and removes legacy UI/runtime drift.

**Architecture:** Keep the Prisma-backed draft services, Next draft APIs, `DraftProvider`, and socket delta flow as the active runtime boundary. Build a new focused room composition around a tested draft-room view model, draft-board grid state, app-shell-aware layout, shadcn-style primitives, semantic theme tokens, and explicit AFL fantasy draft language. Delete or quarantine the old `DraftRoomClient` path only after route searches, typecheck, and browser verification prove the active room has equivalent behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind/shadcn-style UI primitives, existing `DraftProvider`, Socket.IO draft deltas, existing draft API routes, Vitest, Testing Library where available, browser verification against the running dev stack.

---

## Goal Assessment

The intended goal is larger than visual refresh. The draft engine should become a long-term live operations surface for AFL fantasy drafting.

That means the rebuilt room must:

- feel like the same product as the rest of Statly;
- make the live draft workflow obvious under time pressure;
- preserve server-authoritative pick, queue, watchlist, pause, resume, and realtime behavior;
- remove the legacy UI/runtime path that lets future work land in the wrong component;
- improve maintainability by separating draft state derivation, layout, table rows, queue, pick feed, and mobile panels;
- use precise draft language aligned with the repo’s language governance work.

The success measure is not “the page looks newer.” The success measure is that a future contributor can safely change draft UX without rediscovering which runtime is active, which hook is authoritative, which component owns picks, or which terminology should be used.

### Rewritten Goal For This Plan

Rebuild the active live draft room as a board-first, server-authoritative draft operations workspace that can support live drafting today and later support watch-only boards, big-screen mode, slow-draft behavior, and commissioner correction workflows without preserving the legacy component's state model, command model, or visual system.

The best long-term solution is therefore:

- rebuild the user experience around the draft board, not around the available-player table;
- keep server and `DraftProvider` state as the active runtime boundary;
- isolate all derived display logic in a tested view model before rebuilding the UI;
- use semantic Statly/shadcn design tokens instead of legacy hard-coded colors;
- make queue, watchlist, pick feed, pick clock, and commissioner controls explicit surfaces with clear ownership;
- remove or quarantine legacy runtime files after route and behavior verification.

### Plan Quality Assessment

The existing plan is directionally correct because it identifies the old draft room as legacy, names the active runtime path, benchmarks against modern fantasy draft products, and proposes a board-first architecture.

Its remaining weaknesses are execution risks:

- it can still read like a large refactor unless each task enforces one architectural boundary;
- it needs an explicit decision matrix so implementers know what to rebuild, reuse, delete, quarantine, or defer;
- it needs stronger guardrails preventing copy-forward from `DraftRoomClient`;
- it needs phase gates that stop visual work from outrunning the tested view model and runtime ownership proof;
- it needs a clear deletion/quarantine gate so the legacy component does not survive as an attractive nuisance.

This rewrite addresses those risks by adding a rebuild decision matrix, implementation guardrails, and phase checkpoints before the task list.

## Current-State Audit

### Active Runtime Path

Current active route:

```txt
src/app/drafts/[id]/page.tsx
  -> src/app/drafts/[id]/DraftPageClient.tsx
  -> src/contexts/SocketContext.tsx
  -> src/contexts/DraftContext.tsx
  -> src/components/draft/UnifiedDraftRoom.tsx
```

The active runtime uses `DraftProvider`, which normalizes the server snapshot, joins the draft socket room, backfills deltas, hydrates available players, hydrates the current member queue/watchlist, and exposes action APIs for pick, queue, watchlist, and refresh behavior.

This should remain the active state boundary.

### Legacy Runtime Path

Legacy path still present:

```txt
src/components/draft/DraftContainer.tsx
  -> src/app/drafts/[id]/DraftRoomClient.tsx
  -> src/hooks/useRealtimeDraft.ts
```

Risk:

- `DraftRoomClient` is 3,819 lines.
- `DraftContainer` can still render it.
- `useRealtimeDraft` is a second realtime client model.
- The legacy file contains old UI, local draft types, debug logging, hard-coded colors, and old interactions.

This path appears unused by the active route, but it must be proven before deletion.

### Active UI Shape

Important current files:

- `src/components/draft/UnifiedDraftRoom.tsx` - 802 lines.
- `src/components/draft/PlayerGrid.tsx` - 492 lines.
- `src/components/draft/DraftQueue.tsx` - 448 lines.
- `src/components/LivePickHeader.tsx` - live clock/header behavior.
- `src/components/PickFeed.tsx` - recent picks rail.
- `src/components/draft/DraftControls.tsx` - owner pause/resume controls.
- `src/components/draft/DraftStatusBanner.tsx` - non-live lifecycle status.
- `src/components/draft/ConnectionStatus.tsx` - connection recovery banner.

These components contain useful behavior, but they do not form a coherent long-term room architecture.

## Legacy Component Audit

This section treats `src/app/drafts/[id]/DraftRoomClient.tsx` as a legacy component to replace, not as the foundation for the rebuild.

### Audit Scope

Audited files:

- `src/app/drafts/[id]/DraftRoomClient.tsx`
- `src/components/draft/DraftContainer.tsx`
- `src/hooks/useRealtimeDraft.ts`
- active comparison files:
  - `src/components/draft/UnifiedDraftRoom.tsx`
  - `src/contexts/DraftContext.tsx`
  - `src/components/draft/PlayerGrid.tsx`
  - `src/components/draft/DraftQueue.tsx`
  - `src/components/LivePickHeader.tsx`
  - `src/components/PickFeed.tsx`

Audit method:

- map imports and route reachability;
- identify state ownership;
- identify API mutations;
- identify rendering responsibilities;
- identify UX concepts;
- identify styling/design-system violations;
- identify accessibility risks;
- classify each legacy behavior as `do not carry forward`, `rebuild from scratch`, `salvage concept only`, or `reuse existing active implementation`.

### Component Role

`DraftRoomClient` is not one component in practice. It is a full legacy draft application inside one file.

It owns:

- authentication fallback;
- realtime synchronization through `useRealtimeDraft`;
- watchlist mapping through `useWatchlist`;
- alert handling through `useDraftedPlayerAlerts`;
- local filters and sorting;
- local draft-state calculation;
- local pick validation;
- direct pick submission;
- pause/resume mutation;
- draft-order mutation;
- draft start mutation;
- fantasy category configuration UI;
- league customization UI;
- AI-style recommendation scoring;
- keyboard shortcuts;
- multiple table renderers;
- multiple modals;
- pick feed;
- watchlist;
- user roster view;
- owner/admin override UI;
- development logging and test-only behavior.

Assessment:

- This violates the repo’s component design rules and shadcn composition principles.
- It should not be refactored incrementally as the main path.
- It should be deleted or quarantined after the new active draft room covers the required behavior.

### State Ownership Problems

Evidence:

- The legacy component creates many local state islands:
  - `tab`
  - `confirmModal`
  - `fantasySettingsModal`
  - `leagueSettings`
  - `search`
  - `positionFilter`
  - `clubFilter`
  - `sortBy`
  - `sortOrder`
  - `isLoading`
  - `injuryFilter`
  - `quickFilters`
  - `showKeyboardHelp`
  - `leagueCustomization`
  - `showRecommendations`
  - `recommendationCriteria`
  - `autoPickEnabled`
  - `draftError`
  - `draftOrderManagement`
  - `showCustomizationModal`
  - `pickValidation`

Impact:

- Draft state, UI state, settings state, commissioner state, and recommendation state are tangled.
- It is unclear which values come from the server and which are client-only simulation.
- Some state duplicates server authority, especially timer, pick validation, draft order, draft type, and auto-pick settings.

Decision:

- Do not carry this state model forward.
- Rebuild around:
  - `DraftProvider` for server/realtime state;
  - `draftRoomViewModel` for deterministic derived display state;
  - small local UI state only for active panel, search input, selected player confirmation, and mobile drawer/dialog state.

### Realtime Runtime Problems

Evidence:

- Legacy path uses `useRealtimeDraft`.
- Active route uses `DraftProvider`.
- Legacy `DraftContainer` can still route to `DraftRoomClient`.

Impact:

- Two realtime client models exist.
- Future fixes can land in the wrong runtime.
- Socket/backfill behavior cannot be reasoned about from one place.

Decision:

- Do not reuse `useRealtimeDraft` in the rebuild.
- Treat `DraftProvider` as the active runtime boundary.
- Delete `useRealtimeDraft` and `useDraftState` if route/import search proves they are legacy-only.

### API Mutation Problems

Evidence:

Legacy component directly calls:

- `PUT /api/drafts/${draftData.id}/order`
- `POST /api/drafts/${draftData.id}/pick`
- `POST /api/drafts/${draftData.id}/pause`
- `POST /api/drafts/${draftData.id}/resume`
- `POST /api/drafts/${draftData.id}/start`

The active runtime already exposes safer action APIs through `DraftProvider` for pick, queue, watchlist, and refresh. Existing active `DraftControls` separately owns pause/resume.

Impact:

- Command handling is scattered.
- Pick route naming differs from the active route family, where `DraftProvider` posts to `drafts/${draftId}/picks`.
- Draft-order mutation appears inside a UI modal without a durable product/authorization plan.

Decision:

- Do not carry direct command fetches forward from `DraftRoomClient`.
- Route pick, queue, watchlist, and refresh through `DraftProvider`.
- Keep pause/resume isolated in a new `DraftCommissionerPanel`.
- Do not implement draft-order randomization, admin override, undo, reverse-pick, or timer-change operations until backend contracts, authorization, audit logging, and product UX are deliberately designed.

### Draft Math Problems

Evidence:

- Legacy file computes current draft state locally using `liveDraftData.picks.length`, `maxRounds = 22`, `leagueCustomization.draftStyle`, and participant order.
- It also computes current picking team separately using `computeSnakeState(draftData.currentPick, teamCount)`.
- It validates turn state differently in development and production.

Impact:

- Draft order, round, pick, and turn state are duplicated client-side.
- Hard-coded `22` rounds can drift from server settings.
- Development-only relaxed validation can mask real turn bugs.

Decision:

- Do not reuse this local draft-state calculation.
- Build board slots from server-provided `draft.currentPick`, `draft.totalPicks`, `participants`, and `picks`.
- If the server exposes canonical draft order or pick slots, prefer that over client reconstruction.
- Keep all pick validation server-authoritative; client validation should only improve UX, not define correctness.

### Pick Confirmation Problems

Evidence:

- Legacy component has a large confirmation modal with:
  - local validation;
  - admin override copy;
  - fantasy value calculation;
  - injury marker;
  - auto-pick warning;
  - direct API command.

Impact:

- Useful concept, poor implementation boundary.
- Admin override language is mixed into normal user drafting.
- The modal is visually inconsistent and depends on legacy validation.

Decision:

- Salvage concept only: a deliberate pick confirmation step is valuable.
- Rebuild as `DraftPickConfirmationDialog`.
- Copy should be user-safe:
  - `Draft [player name]`
  - `This will use pick [overall] for [fantasy team].`
  - `Cancel`
  - `Draft player`
- Commissioner override must not appear unless a future correction mode is explicitly implemented.

### Queue And Watchlist Problems

Evidence:

- Legacy path uses generic `useWatchlist`, maps it into draft watchlist items, and passes `onAddToQueue={() => {}}` in one path.
- Queue behavior is not the central fallback model.
- Queue/autopick behavior is partly local copy, partly UI toggle, partly timer warning.

Impact:

- Draft-specific watchlist semantics are unclear.
- Queue fallback behavior can be misleading.
- Empty callback indicates incomplete behavior.

Decision:

- Rebuild queue and watchlist as draft-specific panels backed by active `DraftProvider` actions.
- Queue panel must show the actual fallback chain.
- Watchlist is scouting only; queue is auto-pick fallback.
- Avoid `shortlist` as a visible term unless product deliberately defines it.

### Recommendation And Analytics Problems

Evidence:

- Legacy file contains team-category analysis and recommendation scoring.
- Recommendation criteria are client-only:
  - prioritize positions;
  - avoid injured;
  - focus on value;
  - consider team needs.
- Calculations depend on local filtered players and local picks.

Impact:

- This looks powerful but is not trustworthy enough to carry into a rebuilt live command surface.
- It mixes analytics, recommendation logic, settings, and pick actions.
- It is not tested and may be misleading during a live draft.

Decision:

- Do not carry recommendation logic forward into the first rebuild.
- If recommendations are required later, create a separate `DraftRecommendationService` or server-backed read model with tests and transparent scoring.
- The first rebuild may include simple sortable columns and roster-needs display only if sourced from reliable data.

### Commissioner And Admin Problems

Evidence:

- Legacy file includes draft order management, randomization, save order, start draft, pause/resume, and admin override pick copy.
- Keyboard help references undo last pick, but the audited command surface does not show a durable undo implementation.

Impact:

- Commissioner tools are mixed into user drafting.
- Potentially high-impact mutations lack explicit authorization/observability boundaries in the UI plan.
- UI suggests capabilities that may not be safely implemented.

Decision:

- Rebuild pause/resume only because active code already supports it.
- Place all commissioner controls in `DraftCommissionerPanel`.
- Future correction mode must be a separate task with:
  - API contract;
  - authorization;
  - audit logging;
  - confirmation copy;
  - affected projection/roster sync verification.

### Keyboard Shortcut Problems

Evidence:

- Legacy file globally listens for `/`, `?`, `Escape`, and `1-5`.
- It references `Undo Last Pick`.
- It changes tabs globally unless inputs/selects are focused.

Impact:

- Global shortcuts can interfere with browser/app behavior.
- Shortcuts advertise behavior that is not safely supported.
- They add complexity before core mobile/realtime reliability is solved.

Decision:

- Do not carry global shortcuts forward in the first rebuild.
- Keep native keyboard accessibility through semantic controls.
- Add shortcuts later only with visible shortcut documentation and tests.

### Visual And Design-System Problems

Evidence:

- Legacy file is dominated by hard-coded colors and custom surfaces:
  - `bg-gray-*`
  - `bg-blue-*`
  - `bg-green-*`
  - `bg-yellow-*`
  - `bg-purple-*`
  - `bg-indigo-*`
  - many `rounded-lg`, `rounded-full`, and custom table styles.
- It uses emoji and inline SVG in multiple places.

Impact:

- It does not align with shadcn/token-based Statly UI.
- It will not survive theme changes cleanly.
- It looks like a separate product.

Decision:

- Do not preserve visual styling.
- Rebuild with semantic tokens and existing UI primitives.
- Use icons from `lucide-react`.

### Accessibility Problems

Evidence:

- Large custom tables and modals are built manually.
- Global shortcuts are not surfaced in normal navigation.
- Multiple icon/emoji visual states do not have consistently clear accessible names.
- The component mixes clickable rows and buttons.

Impact:

- Screen-reader and keyboard behavior is unreliable.
- Live draft actions may be risky for users relying on assistive tech.

Decision:

- Rebuild tables with semantic table markup or a complete ARIA grid.
- Use real dialogs/drawers where available.
- Avoid row-click drafting.
- Keep explicit accessible labels for icon controls.

### What Can Be Salvaged

Salvage concept only:

- Pick confirmation before committing a draft player.
- Watchlist-player drafted alerts.
- Queue as timeout fallback.
- Position/club/search filters.
- Roster-needs/recommendation idea as a future feature.
- Commissioner pause/resume.
- Draft order visualization.

Reuse active implementation instead:

- `DraftProvider` state/action boundary.
- `SocketContext` join/backfill model.
- Active draft APIs.
- `DraftControls` behavior, after token/design cleanup.
- `LivePickHeader` timer logic only until replaced by `DraftPickClockPanel`.

Do not carry forward:

- `useRealtimeDraft` active usage.
- local `getDraftState` as source of truth.
- local API command fetches from the component.
- development-mode turn validation.
- draft order randomization modal.
- league customization modal.
- fantasy settings modal inside the live room.
- recommendation scoring inside the live room.
- global keyboard shortcuts.
- hard-coded color system.
- admin override pick copy.
- row-click drafting.

### Audit Conclusion

The optimal long-term solution is a rebuild, not a refactor.

`DraftRoomClient` should be treated as a requirements mine and anti-pattern inventory:

- mine it for workflow concepts users may expect;
- do not preserve its architecture;
- do not preserve its styling;
- do not preserve its state model;
- do not preserve direct mutation calls;
- do not preserve untested recommendation/admin features.

Implementation should proceed from the new board-first architecture in this plan, with explicit tests and route-verification gates before legacy deletion.

### Legacy Rebuild Decision Matrix

| Legacy area                       | Decision                           | Reason                                                                                                                  | Long-term target                                                                                                   |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DraftRoomClient` component shell | Delete or quarantine               | The file mixes routing, state, commands, layout, analytics, modals, shortcuts, and styling in one 3,819-line component. | `UnifiedDraftRoom` becomes a thin orchestrator over focused `src/components/draft/room/*` components.              |
| `useRealtimeDraft` runtime        | Delete if unreachable              | The active route already uses `DraftProvider`; a second realtime model creates drift.                                   | `DraftProvider` and `SocketContext` remain the single active client realtime boundary.                             |
| Local draft-state math            | Rebuild                            | Client-side current pick, round, and turn calculation can drift from server authority.                                  | `draftRoomViewModel` derives display state from `DraftProvider` snapshots without owning correctness.              |
| Available-player table            | Rebuild                            | The current and legacy tables are support surfaces, not the primary draft experience.                                   | `DraftPlayerTable` supports search, sort, filters, queue, watchlist, and explicit `Draft player` action.           |
| Draft board                       | Rebuild                            | The legacy implementation does not provide a durable board-first workspace.                                             | `DraftBoardGrid` and `DraftBoardSlot` become the central room surface and future watch-only/big-screen foundation. |
| Pick clock and on-clock state     | Rebuild from active behavior       | Existing timer behavior is useful, but display and fallback copy need clearer ownership.                                | `DraftPickClockPanel` shows server time, current fantasy team, fallback chain, and stale/reconnect state.          |
| Queue                             | Rebuild on active provider actions | Queue is the timeout fallback and must not be confused with watchlist.                                                  | `DraftQueuePanel` shows ordered fallback picks, empty state, reorder/remove actions, and autopick explanation.     |
| Watchlist                         | Rebuild on active provider actions | Watchlist is scouting, not fallback.                                                                                    | `DraftWatchlistPanel` uses precise language and never implies auto-pick priority.                                  |
| Pick feed                         | Rebuild as public context          | Existing feed concept is useful but should not leak private data or legacy copy.                                        | `DraftPickFeedPanel` shows recent picks and can later be reused in watch-only mode.                                |
| Commissioner pause/resume         | Reuse behavior, rebuild UI         | Active behavior exists, but controls need isolation and token-based UI.                                                 | `DraftCommissionerPanel` owns pause/resume and leaves correction mode as a separate future contract.               |
| Draft-order editing/randomization | Defer                              | High-impact mutation requires explicit backend, authorization, audit, and UX contracts.                                 | Future correction/setup workflow, not part of live-room rebuild.                                                   |
| Recommendation scoring            | Defer                              | Legacy scoring is untested, client-only, and risky during live picks.                                                   | Future server-backed recommendation/read-model service with transparent scoring and tests.                         |
| League/fantasy settings modals    | Delete from live room              | Configuration during a live command surface creates confusion and drift.                                                | Draft setup/settings page owns league configuration before the draft starts.                                       |
| Global keyboard shortcuts         | Defer                              | Shortcuts advertise unsupported actions and risk accessibility regressions.                                             | Future shortcuts only after visible documentation and tests.                                                       |
| Hard-coded visual styling         | Delete                             | Legacy colors and surfaces do not align with Statly/shadcn theming.                                                     | Semantic tokens, existing UI primitives, lucide icons, restrained radius.                                          |
| Row-click drafting                | Delete                             | It is too easy to mis-pick under time pressure.                                                                         | Explicit button plus confirmation dialog unless product chooses instant draft later.                               |

## Competitive Research Baseline

This plan should be benchmarked against current fantasy draft-room patterns, not only against the existing Statly component tree.

Primary sources reviewed:

- Sleeper draft timer support: `https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work`
- Sleeper queue vs watchlist support: `https://support.sleeper.com/en/articles/3989685-watch-list-vs-draft-queue`
- Sleeper big-screen draftboard support: `https://support.sleeper.com/articles/2083195-how-to-cast-your-draft-to-the-big-screen`
- Sleeper live/offline draftboard positioning: `https://support.sleeper.com/articles/1876028-why-you-should-use-sleeper-draftboards-for-your-live-draft`
- Sleeper offline draft support: `https://support.sleeper.com/en/articles/2203540-how-to-conduct-an-offline-draft`
- Yahoo live standard draft support: `https://help.yahoo.com/kb/live-standard-draft-sln6230.html`
- Yahoo pre-rank/autopick support: `https://help.yahoo.com/kb/fantasy-football/pre-ranking-players-sln6159.html`
- ESPN autopick support: `https://support.espn.com/hc/en-us/articles/360000063811-Autopick-Draft`
- NFL pre-rank/autopick support: `https://support.nfl.com/hc/en-us/articles/35869798510868-Pre-Rank-Auto-Pick`
- NFL live draft basics: `https://support.nfl.com/hc/en-us/articles/35869693560980-The-Basics`
- Underdog auto-pick priority order: `https://help.underdogfantasy.com/en/articles/10982124-auto-pick-priority-order`
- Underdog draft rankings/autopilot support: `https://help.underdogfantasy.com/en/articles/9180011-draft-rankings-and-autopilot`

### Research Findings

1. State-of-the-art draft rooms are board-first.

   Sleeper positions the draftboard as the central draft surface, including big-screen mode for in-person drafts and live/offline hybrid drafting. NFL describes a draft client that includes draft order, timer, queue, history, rosters, stats, analysis, and chat. Statly should therefore treat the draft board as the primary object, not merely a player table with side panels.

2. Queue/autopick rules must be visible and exact.

   Sleeper, Yahoo, ESPN, NFL, and Underdog all document fallback behavior. Across platforms, auto-pick typically checks a queue or pre-rank list first, then falls back to platform rankings or needs-based logic. Statly should show the current fallback chain near the pick clock and queue, using precise language such as `Queue first, then rankings, then ADP fallback` only if that is the actual server behavior.

3. Commissioner operations are part of the draft-room product.

   Sleeper emphasizes commissioner control such as pause, undo, pick changes, timer changes, and draft fixes. NFL allows commissioners to pause and reverse selections in supported contexts. Statly currently has pause/resume controls; the redesigned architecture should leave clear extension points for correction mode without implementing unsafe broad mutation tools in this rebuild.

4. Slow draft and offline/live hybrid modes should influence layout decisions.

   Sleeper and Fantrax-style slow draft flows support long timers, sleep windows, and picks during paused timer windows. Even if Statly only implements live snake draft now, the room should not hard-code a two-minute-only live experience. The view model should separate draft clock state from draft lifecycle state.

5. Mobile reliability is a competitive differentiator.

   Support docs emphasize queues, mobile drafting, and draft-room access. Community reports for modern platforms frequently cite stale mobile draft boards and autopicks occurring before the visible UI catches up. Statly should treat reconnect status, last event time, stale board warnings, and manual refresh as core mobile UX, not secondary error handling.

6. Watch-only and big-screen views solve a real draft-day use case.

   Sleeper supports casting a draftboard while drafting from another tab. Yahoo and community discussions also highlight the value of presenting a board without exposing private queue/watchlist data. Statly should design the board model so a future public/watch-only draftboard can reuse board slots without private user panels.

### Implications For Statly

The optimal long-term solution is not simply `DraftPlayerTable + Queue + PickFeed`.

The target should be:

```txt
DraftRoom
  DraftBoardWorkspace
    DraftBoardGrid
    DraftPickClockPanel
    DraftCommandPanel
  PrivateManagerPanels
    MyQueue
    Watchlist
    PlayerSearchAndRankings
  PublicContextPanels
    PickFeed
    DraftOrder
    RosterNeeds
  CommissionerPanel
    PauseResume
    FutureCorrectionMode
  ConnectionHealth
    LastEventAt
    ReconnectState
    ManualRefresh
```

This keeps the active implementation practical while preserving room for big-screen mode, watch-only mode, slow draft mode, and commissioner repair workflows.

## Shortcomings Against The Goal

These shortcomings are assessed against the rewritten goal: a long-term board-first live draft workspace, not a cosmetic modernization of the old room.

### 1. The Room Is Not App-Shell Aligned

Evidence:

- `src/app/drafts/[id]/DraftPageClient.tsx` renders the draft room directly.
- Most neighboring draft pages use `AppLayout`.
- `UnifiedDraftRoom` creates its own full-screen shell with hard-coded `bg-gray-50`.

Impact:

- The live room feels detached from the rest of Statly.
- Navigation, spacing, max width, and background treatment drift from the app.
- Future design-system changes need duplicate fixes.

Long-term fix:

- Wrap the draft room in `AppLayout`.
- Use a dedicated `DraftRoomShell` inside the app shell only for live-draft density.
- Use `max-w-[var(--app-shell-max-width)]` unless live workflow evidence proves a wider canvas is needed.

### 2. The Main Room Component Owns Too Many Concerns

Evidence:

- `UnifiedDraftRoom` owns state derivation, filtering, sorting, tabs, layout, queue actions, watchlist actions, pick feed mapping, mobile modal behavior, loading, error, empty state, and summary metrics.

Impact:

- Styling changes are entangled with draft behavior.
- Test coverage is hard to add.
- Future UX changes risk altering pick/queue/watchlist behavior.

Long-term fix:

- Extract a tested view model for draft-room derivations.
- Recompose the room from focused components:
  - `DraftRoomShell`
  - `DraftRoomHeader`
  - `DraftPickClockPanel`
  - `DraftBoardToolbar`
  - `DraftPlayerTable`
  - `DraftPlayerRow`
  - `DraftQueuePanel`
  - `DraftWatchlistPanel`
  - `DraftPickFeedPanel`
  - `DraftRoomMobilePanels`
  - `DraftRoomStates`

### 3. The Legacy Path Can Reintroduce Runtime Drift

Evidence:

- `DraftContainer` imports `DraftRoomClient`.
- `DraftRoomClient` still imports `useRealtimeDraft`.
- Active route uses `DraftProvider`.

Impact:

- Contributors can accidentally repair or extend the wrong room.
- Two realtime models remain in source.
- Debug-only UI and old data assumptions can leak back into product.

Long-term fix:

- Prove the legacy path is unreachable.
- Delete the legacy files if safe.
- If deletion is blocked, quarantine them under an explicit legacy folder and add removal criteria.

### 4. Visual Design Does Not Follow The Current System

Evidence:

- Active room components use hard-coded `gray`, `slate`, `blue`, `amber`, `green`, and `red` classes throughout.
- Multiple components use large `rounded-3xl` cards.
- Inline SVGs are used where `lucide-react` icons exist.
- Emoji appears in empty/injury states.

Impact:

- Light/dark mode and token-driven theming are fragile.
- The draft room reads as a standalone legacy tool.
- Reusable UI primitives are bypassed.

Long-term fix:

- Prefer `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`, and `ring-ring`.
- Use existing `src/components/ui/*` primitives before custom markup.
- Use `lucide-react` icons for action buttons and state markers.
- Keep cards restrained. Use 8px radius unless an existing primitive already defines otherwise.

### 5. Live Draft Workflow Is Not Clear Enough

Evidence:

- Primary player action says `Select`, not `Draft player`.
- Critical live concepts are split across a clock header, summary card, player list, queue rail, tabs, and pick feed.
- Desktop has a `Queue & Watchlist` tab that mostly tells users to use the rail.
- Player rows can draft directly from row click, which is risky under time pressure.
- There is no first-class draft-board grid showing picks by round and fantasy team.

Impact:

- Users can mis-pick.
- Users may miss the best next action.
- Desktop navigation has dead weight.
- Draft progress is harder to understand holistically than in board-first products.

Long-term fix:

- Make the top of the room answer:
  - Who is on the clock?
  - Is it my pick?
  - How much server time remains?
  - What happens if I time out?
  - What is my next queued fallback?
- Make the draft board the center of the room, with available players and private queue panels supporting the board.
- Rename primary action to `Draft player`.
- Make queue/watchlist actions secondary icon buttons with accessible labels.
- Add a deliberate confirmation path for committing a pick unless product explicitly chooses instant draft.

### 6. Terminology Is Inconsistent

Current visible language includes:

- `Select`
- `Pick`
- `Draft`
- `Queue`
- `Shortlist`
- `Watchlist`
- `Activity rail`
- `Desktop rail`
- `Live rail`
- `Board`

Impact:

- Users and contributors see multiple names for the same concept.
- Searchability and analytics naming degrade.

Long-term preferred language:

- `Draft player`
- `Add to queue`
- `Add to watchlist`
- `Pick feed`
- `Draft board`
- `On the clock`
- `My queue`
- `Draft lifecycle status`

### 7. Accessibility Needs To Be Designed, Not Patched

Evidence:

- Tabs have keyboard handling.
- Some buttons have accessible labels.
- The mobile pick feed modal restores focus but is not a complete dialog/focus-trap pattern.
- The player board is visually table-like but implemented with `div role="row"` rather than a complete table/grid semantic structure.

Impact:

- Screen-reader behavior is likely inconsistent.
- Keyboard users may struggle during live draft workflows.

Long-term fix:

- Use semantic table markup for the player board unless a full ARIA grid is deliberately implemented.
- Use dialog/drawer semantics for mobile panels.
- Add live regions for pick submission, connection status, and clock-critical changes.
- Keep visible labels or accessible names for all interactive controls.

### 8. The Current Plan Can Fail If It Preserves Too Much Legacy Behavior

Evidence:

- `DraftRoomClient` contains attractive but unsafe features such as recommendation scoring, draft-order randomization, global shortcuts, and admin override copy.
- Several concepts are useful, but their existing implementation boundaries are not.
- A partial refactor could leave two room architectures alive indefinitely.

Impact:

- The result could look redesigned while still carrying legacy state ownership, command calls, and accessibility problems.
- Future contributors could keep extending the wrong surfaces.
- The project would miss the long-term goal of one active draft runtime and one coherent room architecture.

Long-term fix:

- Treat the decision matrix in this plan as binding.
- Reuse only the active runtime boundary and explicitly listed behavior.
- Rebuild the draft room composition from the tested view model outward.
- Delete or quarantine legacy runtime files as the final delivery gate, not as optional cleanup.

## Target Architecture

### Runtime Boundary

Keep:

- `src/server/draft/**`
- `src/app/api/drafts/**`
- `src/contexts/DraftContext.tsx`
- `src/contexts/SocketContext.tsx`

Avoid:

- Adding another realtime hook.
- Reintroducing `useRealtimeDraft` into the active route.
- Moving draft API contract changes into the UX rebuild.

### View Boundary

Create:

```txt
src/components/draft/room/draftRoomViewModel.ts
src/components/draft/room/draftRoomViewModel.test.ts
```

The view model owns:

- board slots by round and draft order;
- pick ownership by fantasy team;
- current board slot;
- next board slot;
- current participant/member lookup;
- draft slot;
- filtered/sorted available players;
- available position filters;
- visible fantasy categories;
- progress percentage;
- total rounds;
- title/subtitle display;
- turn description;
- drafted player IDs;
- queued player IDs;
- watched player IDs.

It must not call APIs or mutate draft state.

The board model must be reusable by future watch-only and big-screen modes, where private queue and watchlist data must not be exposed.

### Component Boundary

Create:

```txt
src/components/draft/room/DraftRoomShell.tsx
src/components/draft/room/DraftRoomHeader.tsx
src/components/draft/room/DraftBoardGrid.tsx
src/components/draft/room/DraftBoardSlot.tsx
src/components/draft/room/DraftPickClockPanel.tsx
src/components/draft/room/DraftBoardToolbar.tsx
src/components/draft/room/DraftPlayerTable.tsx
src/components/draft/room/DraftPlayerRow.tsx
src/components/draft/room/DraftQueuePanel.tsx
src/components/draft/room/DraftWatchlistPanel.tsx
src/components/draft/room/DraftPickFeedPanel.tsx
src/components/draft/room/DraftCommissionerPanel.tsx
src/components/draft/room/DraftConnectionHealth.tsx
src/components/draft/room/DraftRoomMobilePanels.tsx
src/components/draft/room/DraftRoomStates.tsx
```

Modify:

```txt
src/app/drafts/[id]/DraftPageClient.tsx
src/components/draft/UnifiedDraftRoom.tsx
src/components/draft/DraftControls.tsx
src/components/draft/DraftStatusBanner.tsx
src/components/draft/ConnectionStatus.tsx
```

Delete or quarantine after gates:

```txt
src/app/drafts/[id]/DraftRoomClient.tsx
src/components/draft/DraftContainer.tsx
src/hooks/useRealtimeDraft.ts
src/hooks/useDraftState.ts
```

## Invariants

- Server remains authoritative for draft lifecycle, pick order, pick clock, auto-pick, pause, and resume.
- `DraftProvider` remains authoritative for active client draft state.
- `POST /api/drafts/[id]/picks` remains the pick command route.
- `PUT /api/drafts/[id]/pre-queue` remains the queue update route.
- `/api/drafts/[id]/watchlist` remains the watchlist route.
- No database migration is part of this UX rebuild.
- No public API contract change is part of this UX rebuild.
- No new dependency is added without explicit approval.
- Legacy deletion happens only after active route verification.
- Private queue and watchlist data must not be included in any future watch-only or big-screen board view.
- Draft clock display must distinguish draft lifecycle status from timer state.
- The visible autopick fallback chain must match server behavior exactly.

## Implementation Guardrails

These rules prevent the rebuild from becoming a legacy transplant.

- Do not copy JSX, state shape, mutation fetches, keyboard handlers, recommendation logic, modals, or styling from `src/app/drafts/[id]/DraftRoomClient.tsx`.
- Do not introduce a new realtime hook or local draft-state owner.
- Do not call draft mutation APIs directly from leaf UI components unless the active provider has no command for that behavior and the task explicitly documents why.
- Do not implement draft-order editing, undo, reverse pick, timer editing, recommendation scoring, or commissioner correction mode in this rebuild.
- Do not expose private queue or watchlist state in board components intended for future public, watch-only, or big-screen reuse.
- Do not rely on color-only state. Pair visual state with text, icons, accessible names, or live-region updates where relevant.
- Do not make the player table the primary layout anchor. The draft board is the main surface; the player table supports the next pick.
- Do not keep the legacy runtime reachable after the active route is verified unless it is explicitly quarantined with removal criteria.

## Execution Phases

### Phase 1: Runtime And View-Model Proof

Complete Tasks 1-3 before any visual rebuild.

Exit criteria:

- active route ownership is proven by search;
- legacy reachability is documented;
- `draftRoomViewModel` has tests covering board slots, current slot, queued/watched IDs, drafted IDs, filter/sort behavior, and progress;
- no route imports `useRealtimeDraft` in the active path.

### Phase 2: Shell And Board Foundation

Complete Tasks 4-10 before replacing the player table or private panels.

Exit criteria:

- the active draft route is app-shell aligned;
- loading/error/not-found states use semantic tokens;
- the draft board renders as the primary workspace;
- the pick clock exposes on-clock state, server timer state, and fallback copy without private data leakage;
- toolbar controls use precise draft language and accessible labels.

### Phase 3: Private Manager Panels

Complete Tasks 11-15 after the board foundation is stable.

Exit criteria:

- player table supports explicit `Draft player`, queue, and watchlist actions;
- queue and watchlist are visually and semantically distinct;
- pick feed is public-context safe;
- commissioner controls are isolated to pause/resume;
- mobile users can reach board, search, queue, watchlist, and feed without floating legacy UI.

### Phase 4: Recomposition And Legacy Exit

Complete Tasks 16-17 only after browser verification of the active route.

Exit criteria:

- `UnifiedDraftRoom` is an orchestrator, not a multipurpose room application;
- legacy files are deleted or quarantined;
- search proves the active route no longer references legacy runtime files;
- typecheck and browser verification pass against the running dev stack.

## PROPOSED EDIT PLAN

Working with: active draft room route, active draft UI components, and new files under `src/components/draft/room/`
Total planned edits: 17

### Edit sequence:

1. Confirm active runtime and legacy reachability - Purpose: prevent rebuilding or deleting the wrong path.
2. Add draft-room view model tests - Purpose: lock derivations before UI changes.
3. Create draft-room view model - Purpose: move board slots, filtering, sorting, and display derivation out of JSX.
4. Wrap active room in `AppLayout` - Purpose: align with the rest of Statly.
5. Create token-based room states - Purpose: replace legacy loading/error/not-found surfaces.
6. Create `DraftRoomShell` - Purpose: define the durable live-draft workspace layout.
7. Create `DraftRoomHeader` - Purpose: centralize title, lifecycle status, progress, and navigation.
8. Create `DraftBoardGrid` and `DraftBoardSlot` - Purpose: make the draft board the primary room surface.
9. Create `DraftPickClockPanel` - Purpose: make server-authoritative clock, timer mode, and turn state obvious.
10. Create `DraftBoardToolbar` - Purpose: standardize search/filter/sort controls.
11. Create `DraftPlayerTable` and `DraftPlayerRow` - Purpose: make available-player selection a support workflow for the board.
12. Create `DraftQueuePanel`, `DraftWatchlistPanel`, and `DraftPickFeedPanel` - Purpose: standardize side panels and terminology.
13. Create `DraftCommissionerPanel` - Purpose: isolate pause/resume now and leave a safe future correction-mode boundary.
14. Create `DraftConnectionHealth` - Purpose: expose realtime health, last event time, stale board warning, and refresh.
15. Create `DraftRoomMobilePanels` - Purpose: make mobile board, queue, watchlist, and feed reachable without floating legacy UI.
16. Recompose `UnifiedDraftRoom` - Purpose: turn it into orchestration below 300 lines.
17. Remove or quarantine legacy runtime path - Purpose: eliminate future drift after verification gates pass.

Dependencies:

- Edits 1-3 must happen before visual work.
- Edits 4-15 can be reviewed one file at a time.
- Edit 16 depends on the new components existing.
- Edit 17 depends on route search, typecheck, and browser verification.

## Task 1: Confirm Runtime Ownership

**Files:**

- Read: `src/app/drafts/[id]/page.tsx`
- Read: `src/app/drafts/[id]/DraftPageClient.tsx`
- Read: `src/components/draft/UnifiedDraftRoom.tsx`
- Read: `src/components/draft/DraftContainer.tsx`
- Read: `src/app/drafts/[id]/DraftRoomClient.tsx`

- [ ] **Step 1: Search active and legacy imports**

Run:

```bash
rg -n "DraftRoomClient|DraftContainer|UnifiedDraftRoom|useRealtimeDraft|useDraftState|DraftProvider" src
```

Expected:

```txt
Active route references DraftProvider and UnifiedDraftRoom.
Legacy files only reference DraftRoomClient/useRealtimeDraft/useDraftState.
```

- [ ] **Step 2: Document the result in the implementation notes**

Record:

```md
Active draft route:

- `src/app/drafts/[id]/page.tsx`
- `src/app/drafts/[id]/DraftPageClient.tsx`
- `src/contexts/DraftContext.tsx`
- `src/components/draft/UnifiedDraftRoom.tsx`

Legacy draft route candidates:

- `src/components/draft/DraftContainer.tsx`
- `src/app/drafts/[id]/DraftRoomClient.tsx`
- `src/hooks/useRealtimeDraft.ts`
- `src/hooks/useDraftState.ts`

Deletion gate:

- No active route imports legacy files.
```

## Task 2: Add View Model Tests First

**Files:**

- Create: `src/components/draft/room/draftRoomViewModel.test.ts`

- [ ] **Step 1: Add the test file**

```ts
import { describe, expect, it } from 'vitest';

import { buildDraftRoomViewModel } from './draftRoomViewModel';

const baseDraft = {
  id: 'draft-1',
  leagueId: 'league-1',
  name: 'Draft draft-1',
  status: 'LIVE',
  currentPick: 4,
  totalPicks: 44,
  round: 1,
  direction: 'FORWARD',
  settings: { totalRounds: 4 },
} as any;

const participants = [
  { id: 'member-1', userId: 'user-1', displayName: 'One', draftOrder: 1, queue: ['p2'] },
  { id: 'member-2', userId: 'user-2', displayName: 'Two', draftOrder: 2, queue: [] },
] as any;

const players = [
  { id: 'p1', name: 'Zed Mid', position: 'MID', club: 'Carlton', adp: 22 },
  { id: 'p2', name: 'Alpha Def', position: 'DEF', club: 'Adelaide', adp: 3 },
] as any;

describe('buildDraftRoomViewModel', () => {
  it('identifies the current draft member and queue', () => {
    const model = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: ['goals' as any],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(model.currentMemberId).toBe('member-1');
    expect(model.currentDraftSlot).toBe(1);
    expect(model.queuedPlayerIds).toEqual(['p2']);
  });

  it('filters and sorts available players without mutating the source list', () => {
    const model = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: 'a', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(model.filteredPlayers.map((player) => player.id)).toEqual(['p2', 'p1']);
    expect(players.map((player: any) => player.id)).toEqual(['p1', 'p2']);
  });

  it('uses precise live and paused turn language', () => {
    const liveModel = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: true,
      connectionStatus: 'connected',
    });

    const pausedModel = buildDraftRoomViewModel({
      draft: { ...baseDraft, status: 'PAUSED' },
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(liveModel.turnDescription).toContain('pick clock');
    expect(pausedModel.turnDescription).toContain('paused');
  });

  it('builds board slots without exposing private queue data', () => {
    const model = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [
        {
          id: 'pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          player: players[0],
          member: { id: 'member-1', displayName: 'One' },
          auto: false,
          madeAt: new Date().toISOString(),
        },
      ] as any,
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [{ playerId: 'p2' }],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(model.boardSlots[0]).toMatchObject({
      overallPick: 1,
      round: 1,
      draftOrder: 1,
      memberId: 'member-1',
      playerId: 'p1',
    });
    expect(model.boardSlots[1]).toMatchObject({
      overallPick: 2,
      round: 1,
      draftOrder: 2,
      memberId: 'member-2',
      playerId: null,
    });
    expect(model.boardSlots[0]).not.toHaveProperty('queue');
    expect(model.boardSlots[0]).not.toHaveProperty('watchlistItems');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/components/draft/room/draftRoomViewModel.test.ts
```

Expected:

```txt
FAIL because draftRoomViewModel.ts does not exist yet.
```

## Task 3: Create The Draft Room View Model

**Files:**

- Create: `src/components/draft/room/draftRoomViewModel.ts`

- [ ] **Step 1: Implement the view model**

```ts
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type { DraftParticipant, DraftPick, DraftPlayer, DraftState } from '@/types/draft';

export type DraftPlayerSortKey = 'adp' | 'name' | 'position' | 'club';

export interface DraftRoomFilters {
  searchQuery: string;
  positionFilter: string;
  sortBy: DraftPlayerSortKey;
}

export interface DraftRoomViewModelInput {
  draft: DraftState;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  selectedCategories: FantasyCategoryKey[];
  watchlistItems: Array<{ playerId: string }>;
  currentUserId: string;
  filters: DraftRoomFilters;
  isYourTurn: boolean;
  connectionStatus: string;
}

export interface DraftRoomViewModel {
  boardSlots: DraftBoardSlotViewModel[];
  currentParticipant: DraftParticipant | undefined;
  currentMemberId: string;
  currentDraftSlot: number | undefined;
  filteredPlayers: DraftPlayer[];
  availablePositions: string[];
  visibleCategories: FantasyCategoryKey[];
  draftProgressPercent: number;
  totalRounds: number | null;
  displayDraftTitle: string;
  displayDraftSubtitle: string;
  turnDescription: string;
  queuedPlayerIds: string[];
  draftedPlayerIds: string[];
  watchedPlayerIds: string[];
}

export interface DraftBoardSlotViewModel {
  overallPick: number;
  round: number;
  draftOrder: number;
  memberId: string;
  memberDisplayName: string;
  isCurrentPick: boolean;
  isCompleted: boolean;
  playerId: string | null;
  playerName: string | null;
  playerPosition: string | null;
  playerClub: string | null;
  isAutoPick: boolean;
}

function resolveDraftOrderForPick(overallPick: number, teamCount: number): number {
  const round = Math.ceil(overallPick / teamCount);
  const indexWithinRound = ((overallPick - 1) % teamCount) + 1;
  return round % 2 === 1 ? indexWithinRound : teamCount - indexWithinRound + 1;
}

function buildBoardSlots({
  draft,
  participants,
  picks,
}: {
  draft: DraftState;
  participants: DraftParticipant[];
  picks: DraftPick[];
}): DraftBoardSlotViewModel[] {
  const teamCount = participants.length;
  if (teamCount === 0 || draft.totalPicks <= 0) return [];

  const participantsByDraftOrder = new Map(
    participants.map((participant) => [Number(participant.draftOrder), participant])
  );
  const picksByOverall = new Map(picks.map((pick) => [Number(pick.overall), pick]));

  return Array.from({ length: draft.totalPicks }, (_, index) => {
    const overallPick = index + 1;
    const round = Math.ceil(overallPick / teamCount);
    const draftOrder = resolveDraftOrderForPick(overallPick, teamCount);
    const participant = participantsByDraftOrder.get(draftOrder);
    const pick = picksByOverall.get(overallPick);

    return {
      overallPick,
      round,
      draftOrder,
      memberId: participant?.id ?? '',
      memberDisplayName: participant?.displayName ?? `Team ${draftOrder}`,
      isCurrentPick: overallPick === draft.currentPick,
      isCompleted: Boolean(pick),
      playerId: pick?.player?.id ?? null,
      playerName: pick?.player?.name ?? null,
      playerPosition: pick?.player?.position ?? null,
      playerClub: pick?.player?.club ?? null,
      isAutoPick: Boolean(pick?.auto),
    };
  });
}

export function buildDraftRoomViewModel(input: DraftRoomViewModelInput): DraftRoomViewModel {
  const currentParticipant = input.participants.find(
    (participant) => String(participant.userId) === String(input.currentUserId)
  );
  const currentDraftSlot = currentParticipant?.draftOrder;
  const currentMemberId = currentParticipant?.id ?? '';
  const searchQuery = input.filters.searchQuery.trim().toLowerCase();

  const searchedPlayers = searchQuery
    ? input.availablePlayers.filter(
        (player) =>
          player.name.toLowerCase().includes(searchQuery) ||
          player.club.toLowerCase().includes(searchQuery) ||
          player.position.toLowerCase().includes(searchQuery)
      )
    : input.availablePlayers;

  const positionedPlayers =
    input.filters.positionFilter === 'ALL'
      ? searchedPlayers
      : searchedPlayers.filter((player) => player.position === input.filters.positionFilter);

  const filteredPlayers = [...positionedPlayers].sort((a, b) => {
    if (input.filters.sortBy === 'adp') {
      return Number(a.adp ?? 999) - Number(b.adp ?? 999);
    }

    return String(a[input.filters.sortBy] ?? '').localeCompare(
      String(b[input.filters.sortBy] ?? '')
    );
  });

  const derivedTotalRounds =
    input.draft.totalPicks > 0 && input.participants.length > 0
      ? Math.ceil(input.draft.totalPicks / input.participants.length)
      : null;
  const totalRounds = input.draft.settings?.totalRounds ?? derivedTotalRounds;
  const draftProgressPercent =
    input.draft.totalPicks > 0
      ? Math.min(100, Math.max(0, (input.draft.currentPick / input.draft.totalPicks) * 100))
      : 0;
  const hasPlaceholderDraftName =
    !input.draft.name ||
    input.draft.name === input.draft.id ||
    input.draft.name === `Draft ${input.draft.id}`;
  const displayDraftTitle = hasPlaceholderDraftName ? 'League Draft' : input.draft.name;
  const displayDraftSubtitle =
    totalRounds && totalRounds > 0
      ? `Round ${input.draft.round} of ${totalRounds}. Pick ${input.draft.currentPick} of ${input.draft.totalPicks}.`
      : `Pick ${input.draft.currentPick} of ${input.draft.totalPicks}.`;
  const turnDescription = input.isYourTurn
    ? 'Your pick clock is active. Your queue is the fallback if time expires.'
    : input.draft.status === 'PAUSED'
      ? 'Draft is paused. The server clock and auto-pick are stopped.'
      : input.draft.status === 'LIVE'
        ? 'Waiting for your pick. Keep your queue ready before the clock reaches you.'
        : `Connection: ${input.connectionStatus}`;

  return {
    boardSlots: buildBoardSlots({
      draft: input.draft,
      participants: input.participants,
      picks: input.picks,
    }),
    currentParticipant,
    currentMemberId,
    currentDraftSlot,
    filteredPlayers,
    availablePositions: [
      'ALL',
      ...Array.from(new Set(input.availablePlayers.map((player) => player.position))).sort(),
    ],
    visibleCategories: input.selectedCategories.slice(0, 6),
    draftProgressPercent,
    totalRounds,
    displayDraftTitle,
    displayDraftSubtitle,
    turnDescription,
    queuedPlayerIds: currentParticipant?.queue ?? [],
    draftedPlayerIds: input.picks
      .map((pick) => String(pick.player?.id ?? ''))
      .filter((playerId) => playerId.length > 0),
    watchedPlayerIds: input.watchlistItems.map((item) => String(item.playerId)),
  };
}
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
npm test -- src/components/draft/room/draftRoomViewModel.test.ts
```

Expected:

```txt
PASS src/components/draft/room/draftRoomViewModel.test.ts
```

## Task 4: Align The Active Route With The App Shell

**Files:**

- Modify: `src/app/drafts/[id]/DraftPageClient.tsx`

- [ ] **Step 1: Wrap the room in `AppLayout`**

```tsx
'use client';

import React from 'react';

import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';
import { AppLayout } from '@/components/navigation';
import { DraftProvider } from '@/contexts/DraftContext';
import { SocketProvider } from '@/contexts/SocketContext';

export default function DraftPageClient({
  draftId,
  userId,
  initialSnapshot,
}: {
  draftId: string;
  userId: string;
  initialSnapshot: Record<string, any> | null;
}) {
  return (
    <AppLayout>
      <SocketProvider>
        <DraftProvider draftId={draftId} userId={userId} initialSnapshot={initialSnapshot as any}>
          <UnifiedDraftRoom draftId={draftId} userId={userId} />
        </DraftProvider>
      </SocketProvider>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Verify active route still responds**

Run:

```bash
curl -I --max-time 10 http://localhost:3000/drafts
```

Expected:

```txt
HTTP/1.1 200 OK
```

## Task 5: Create Token-Based Room States

**Files:**

- Create: `src/components/draft/room/DraftRoomStates.tsx`

- [ ] **Step 1: Implement room states**

```tsx
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function DraftRoomLoadingState() {
  return (
    <section className="mx-auto flex min-h-[28rem] w-full max-w-[var(--app-shell-max-width)] items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
      <div className="text-center">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Loading draft room</h1>
        <p className="mt-2 text-sm text-muted-foreground">Preparing the latest draft state.</p>
      </div>
    </section>
  );
}

export function DraftRoomErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <section className="mx-auto flex min-h-[28rem] w-full max-w-[var(--app-shell-max-width)] items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
      <div className="max-w-md rounded-md border border-border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Draft room could not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button type="button" className="mt-5" onClick={onRetry}>
          Retry draft room
        </Button>
      </div>
    </section>
  );
}

export function DraftRoomNotFoundState() {
  return (
    <section className="mx-auto flex min-h-[28rem] w-full max-w-[var(--app-shell-max-width)] items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
      <div className="max-w-md rounded-md border border-border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Draft room not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This draft may have been deleted or you may not have access to it.
        </p>
      </div>
    </section>
  );
}
```

## Task 6: Create The Room Shell

**Files:**

- Create: `src/components/draft/room/DraftRoomShell.tsx`

- [ ] **Step 1: Implement shell**

```tsx
import type { ReactNode } from 'react';

export function DraftRoomShell({
  top,
  left,
  main,
  right,
  mobile,
}: {
  top: ReactNode;
  left: ReactNode;
  main: ReactNode;
  right: ReactNode;
  mobile: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 pb-6 pt-4 sm:px-6 lg:px-8 2xl:px-10">
      <div className="space-y-4">
        {top}
        <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
          <aside className="hidden xl:block">
            <div className="sticky top-24 space-y-4">{left}</div>
          </aside>
          <main className="min-w-0 space-y-4">{main}</main>
          <aside className="hidden xl:block">
            <div className="sticky top-24">{right}</div>
          </aside>
        </div>
        <div className="xl:hidden">{mobile}</div>
      </div>
    </section>
  );
}
```

## Task 7: Create The Header

**Files:**

- Create: `src/components/draft/room/DraftRoomHeader.tsx`

- [ ] **Step 1: Implement header**

```tsx
import Link from 'next/link';

import { ArrowLeft, History } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function DraftRoomHeader({
  status,
  title,
  subtitle,
  progressPercent,
  roundLabel,
  pickLabel,
  turnLabel,
  turnDescription,
}: {
  status: string;
  title: string;
  subtitle: string;
  progressPercent: number;
  roundLabel: string;
  pickLabel: string;
  turnLabel: string;
  turnDescription: string;
}) {
  return (
    <header className="rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {status}
            </span>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/drafts">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Back to drafts
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/drafts/history">
              <History className="mr-2 h-4 w-4" aria-hidden />
              History
            </Link>
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_repeat(3,9rem)]">
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Draft progress</span>
            <span>{progressPercent.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <Metric label="Round" value={roundLabel} />
        <Metric label="Pick" value={pickLabel} />
        <Metric label="Turn" value={turnLabel} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{turnDescription}</p>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}
```

## Task 8: Create The Draft Board Grid

**Files:**

- Create: `src/components/draft/room/DraftBoardGrid.tsx`
- Create: `src/components/draft/room/DraftBoardSlot.tsx`

- [ ] **Step 1: Implement a board-first draft grid**

Requirements:

- Render board slots grouped by round.
- Highlight the current pick slot.
- Show completed picks with player name, position, AFL club, fantasy team, pick number, and auto-pick marker.
- Show empty future picks with fantasy team and pick number.
- Do not include private queue or watchlist data.
- Keep the component usable for future watch-only and big-screen modes.

- [ ] **Step 2: Add responsive board behavior**

Requirements:

- Desktop: board grid is the primary center surface.
- Tablet/mobile: board is horizontally scrollable or collapses by round without hiding the current pick.
- Current pick remains easy to locate.

## Task 9: Create The Pick Clock Panel

**Files:**

- Create: `src/components/draft/room/DraftPickClockPanel.tsx`
- Optionally modify: `src/components/LivePickHeader.tsx`

- [ ] **Step 1: Create a focused panel that wraps current clock data**

Implementation requirement:

- Accept the same normalized data currently passed to `LivePickHeader`.
- Use semantic tokens.
- Use `On the clock`, `Your pick`, `Next up`, and `Server clock` language.
- Keep timer calculation server-deadline based.
- Do not change pick command behavior.

- [ ] **Step 2: Preserve `LivePickHeader` temporarily**

Keep `LivePickHeader` available until browser verification proves the replacement covers:

- live clock;
- paused state;
- completed state;
- current team;
- next team;
- owner controls.

## Task 10: Create The Board Toolbar

**Files:**

- Create: `src/components/draft/room/DraftBoardToolbar.tsx`

- [ ] **Step 1: Implement controlled toolbar**

Implementation requirement:

- Use existing UI input/select primitives where possible.
- Search label: `Search draft players`.
- Sort labels:
  - `Sort by ADP`
  - `Sort by name`
  - `Sort by position`
  - `Sort by AFL club`
- Summary copy: `{visibleCount} of {totalCount} available players`.

## Task 11: Create The Player Table

**Files:**

- Create: `src/components/draft/room/DraftPlayerTable.tsx`
- Create: `src/components/draft/room/DraftPlayerRow.tsx`

- [ ] **Step 1: Implement semantic table markup**

Requirements:

- Use `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, and `<td>`.
- Primary action label: `Draft player`.
- Secondary icon actions:
  - `Add [player] to queue`
  - `[player] is already in your queue`
  - `Add [player] to watchlist`
  - `Remove [player] from watchlist`
- Do not draft from row click.
- Keep row text non-overlapping at desktop and tablet widths.

## Task 12: Create Queue, Watchlist, And Feed Panels

**Files:**

- Create: `src/components/draft/room/DraftQueuePanel.tsx`
- Create: `src/components/draft/room/DraftWatchlistPanel.tsx`
- Create: `src/components/draft/room/DraftPickFeedPanel.tsx`

- [ ] **Step 1: Implement panels with consistent terminology**

Requirements:

- Queue title: `My queue`.
- Watchlist title: `Watchlist`.
- Feed title: `Pick feed`.
- Queue description must explain timeout fallback.
- Feed filters should be `All`, `My picks`, and `Watchlist`.
- Use semantic tokens and existing button primitives.

## Task 13: Create The Commissioner Panel

**Files:**

- Create: `src/components/draft/room/DraftCommissionerPanel.tsx`

- [ ] **Step 1: Move owner controls into an isolated commissioner panel**

Requirements:

- Include existing pause/resume behavior.
- Use precise labels:
  - `Pause draft clock`
  - `Resume draft clock`
- Explain whether auto-pick is active or suppressed.
- Leave explicit extension points for future correction mode:
  - reverse pick;
  - edit pick;
  - force auto-pick;
  - change timer.
- Do not implement new mutation operations in this task.

## Task 14: Create Connection Health

**Files:**

- Create: `src/components/draft/room/DraftConnectionHealth.tsx`
- Modify: `src/components/draft/ConnectionStatus.tsx`

- [ ] **Step 1: Add realtime health UX**

Requirements:

- Show connection state when not connected.
- Show `lastEventAt` where available.
- Warn when the board may be stale.
- Provide a manual refresh action.
- Use mobile-safe copy that tells users what will happen if the board is out of sync.

## Task 15: Create Mobile Panels

**Files:**

- Create: `src/components/draft/room/DraftRoomMobilePanels.tsx`

- [ ] **Step 1: Implement mobile access to secondary panels**

Requirements:

- Mobile users can reach:
  - My queue
  - Watchlist
  - Pick feed
- Use tabs, drawer, or dialog semantics from existing primitives.
- Keep focus management explicit.
- Avoid floating unlabeled buttons.

## Task 16: Recompose `UnifiedDraftRoom`

**Files:**

- Modify: `src/components/draft/UnifiedDraftRoom.tsx`

- [ ] **Step 1: Replace inline derivations with the view model**

Remove from JSX orchestration:

- manual filter implementation;
- manual sort implementation;
- manual available-position derivation;
- manual title/subtitle/progress derivation;
- manual drafted/queued/watched ID derivation where covered by view model.

- [ ] **Step 2: Replace layout with new components**

Target structure:

```tsx
return (
  <DraftErrorBoundary>
    <ConnectionStatus status={draft.connection.status} onRefresh={() => draft.forceRefresh()} />
    <DraftRoomShell
      top={
        <>
          {activeDraft.status === 'LIVE' ? (
            <DraftPickClockPanel />
          ) : (
            <>
              <DraftControls />
              <DraftStatusBanner />
            </>
          )}
          <DraftRoomHeader />
        </>
      }
      left={<DraftQueuePanel />}
      main={
        <>
          <DraftBoardGrid />
          <DraftBoardToolbar />
          <DraftPlayerTable />
        </>
      }
      right={
        <>
          <DraftPickFeedPanel />
          <DraftCommissionerPanel />
        </>
      }
      mobile={<DraftRoomMobilePanels />}
    />
    {ConfirmationModal}
  </DraftErrorBoundary>
);
```

- [ ] **Step 3: Confirm file size**

Run:

```bash
wc -l src/components/draft/UnifiedDraftRoom.tsx
```

Expected:

```txt
Fewer than 300 lines, unless a specific remaining concern is documented.
```

## Task 17: Remove Or Quarantine Legacy Runtime Path

**Files:**

- Delete or quarantine: `src/app/drafts/[id]/DraftRoomClient.tsx`
- Delete or quarantine: `src/components/draft/DraftContainer.tsx`
- Delete after import search: `src/hooks/useRealtimeDraft.ts`
- Delete after import search: `src/hooks/useDraftState.ts`

- [ ] **Step 1: Search imports**

Run:

```bash
rg -n "DraftRoomClient|DraftContainer|useRealtimeDraft|useDraftState" src
```

Expected:

```txt
Only legacy files reference each other.
```

- [ ] **Step 2: Delete or quarantine**

Decision rule:

- Delete if no active route or test imports the files.
- Quarantine under a clearly named legacy location only if deletion breaks a known non-production workflow.

- [ ] **Step 3: Re-run import search**

Run:

```bash
rg -n "DraftRoomClient|DraftContainer|useRealtimeDraft|useDraftState" src
```

Expected:

```txt
No results, unless quarantined files remain with explicit deprecation comments.
```

## Verification Plan

Run after each completed task where relevant:

```bash
npm test -- src/components/draft/room/draftRoomViewModel.test.ts
npm run typecheck:app
```

Run after recomposition:

```bash
npm run lint -- src/app/drafts/[id]/DraftPageClient.tsx src/components/draft src/components/LivePickHeader.tsx
```

Run with the dev stack:

```bash
npm run dev:stack
```

Browser-check these routes:

```txt
http://localhost:3000/drafts
http://localhost:3000/drafts/create
http://localhost:3000/drafts/history
http://localhost:3000/drafts/settings
http://localhost:3000/drafts/[known-draft-id]
```

Verify:

- global navigation is present;
- the room uses the same app shell as `/drafts`;
- the draft board is the primary room surface;
- the current pick is visible without searching;
- board slots do not reveal private queue or watchlist data;
- available players load;
- search/filter/sort works;
- `Draft player` is disabled when it is not the user’s pick;
- the pick clock clearly explains the exact auto-pick fallback chain;
- queue updates persist and visually update;
- watchlist updates persist and visually update;
- pick feed updates after a pick delta;
- pause/resume controls work for league owner;
- disconnected/reconnecting/stale-board state gives a clear recovery path;
- mobile users can reach board, queue, watchlist, and pick feed;
- mobile reconnect does not hide the current pick or queue fallback;
- no visible text overlaps in desktop or mobile viewports.

## Migration Risk

- Legacy deletion is the riskiest step. Do not delete until import search and active route verification pass.
- `DraftProvider` changes are out of scope unless a current bug blocks the rebuild.
- Draft API contract changes are out of scope.
- Database changes are out of scope.
- Large visual changes should happen through new focused components, not by repeatedly patching the 802-line room file.
- If a task discovers a behavior gap, stop and update this plan before continuing.

## Acceptance Criteria

- The active draft room renders inside the Statly app shell.
- `UnifiedDraftRoom` is reduced to orchestration and no longer owns every layout/detail concern.
- Draft-room derivations are covered by view model tests.
- The player board uses semantic table or deliberately complete grid semantics.
- Primary pick action is named `Draft player`.
- Queue, watchlist, and pick feed are reachable on desktop and mobile.
- Draft board slots are reusable for future watch-only and big-screen modes.
- Queue/autopick fallback rules are visible and match server behavior.
- Realtime health includes disconnected, reconnecting, stale board, last event, and manual refresh states.
- Hard-coded visual classes are materially reduced in the active room and replaced by semantic tokens.
- Inline SVGs in active room controls are replaced with existing icons where practical.
- The legacy `DraftRoomClient` runtime path is deleted or quarantined with explicit removal criteria.
- Typecheck passes.
- Focused tests pass.
- Browser verification passes against the dev stack.

## Self-Review

- Spec coverage: This rewrite assesses the plan goal, identifies shortcomings against that goal, and defines a long-term implementation strategy rather than a styling patch.
- Placeholder scan: No unresolved placeholder markers are used.
- Type consistency: New architecture keeps existing `DraftProvider`, `DraftState`, `DraftPlayer`, `DraftPick`, and `DraftParticipant` concepts as the active runtime vocabulary.

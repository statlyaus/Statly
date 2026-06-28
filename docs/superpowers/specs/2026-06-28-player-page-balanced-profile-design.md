# Player Page Balanced Profile Design

## Context

The current player detail page at `/players/nick-daicos-collingwood` now loads after the API envelope fixes, but the UX still reads as a sparse error-recovery page:

- the player summary is visually isolated from the performance sections;
- chart and match-log areas do not feel like a single profile surface;
- valid empty match-log responses can look like failures if styled too aggressively;
- the first viewport lacks a clear hierarchy for player identity, availability, and core facts.

The approved direction is **A. Balanced profile dashboard** from the visual companion session. This direction improves hierarchy and confidence without inventing rankings, ownership, or advanced values that are not currently available.

## Goals

- Present the player profile as a coherent dashboard, not disconnected cards.
- Make player identity, club, injury status, games, and position scannable above the fold.
- Frame Recent Performance and Match Logs as sibling analysis panels.
- Treat empty match logs as a valid empty state with calm copy and a refresh action.
- Preserve keyboard accessibility, responsive behavior, and existing data contracts.

## Non-Goals

- Do not add new API fields, rankings, projections, ownership metrics, or mock data.
- Do not introduce new dependencies.
- Do not redesign the app shell or global theme.
- Do not replace the existing chart/table components wholesale unless a narrow local edit is safer.
- Do not turn this into a marketing or landing-page hero.

## Proposed UX

### Player Summary

`PlayerSummaryCard` becomes the visual anchor for the page:

- a dark, restrained profile header band using semantic theme-compatible utilities where practical;
- large player name;
- compact chips for club, position when present, and injury status;
- a small stat rail for Games and Position;
- no red error-style treatment for injury beyond a clear status chip.

The card should remain data-driven. Missing position should render as `-` or be omitted in a predictable way, not crash or create layout holes.

### Page Layout

`PlayerDetail` owns the page composition:

- constrained max-width container with consistent horizontal padding;
- summary card first;
- two-column desktop grid for Recent Performance and Match Logs;
- single-column mobile layout;
- consistent panel framing for chart and table/empty states.

The page should feel like a product tool: quiet, scannable, and useful for repeat visits.

### Recent Performance

Keep the existing `PlayerChart` behavior and data inputs. Improve its container treatment only enough to align with the new page:

- clear heading hierarchy;
- muted supporting label for the 9-category round-by-round context;
- stable chart area height;
- neutral panel border/background.

When match data is empty, the chart should not imply an app error.

### Match Logs Empty State

The empty match-log state should communicate that the request succeeded but no rows are available:

- heading: `No match data available`;
- body copy: `No match logs were returned for Nick Daicos.`;
- keep the refresh action;
- use neutral/muted styling instead of red failure styling.

For non-empty data, preserve existing sort/filter/table behavior.

## Component Boundaries

Primary files expected for implementation:

- `src/components/PlayerSummaryCard.tsx`
- `src/components/PlayerDetail.tsx`
- `src/components/PlayerChart.tsx` if chart panel polish is needed
- `src/components/MatchLogTable.tsx` if empty-state polish is needed

Avoid broader API or global theme changes. The earlier API envelope normalization remains a prerequisite but is not part of this design scope.

## Accessibility

- Interactive refresh controls must remain native buttons with accessible names.
- Injury/status chips are visual labels, not hidden state.
- Heading order should stay logical: player profile first, then Recent Performance and Match Logs.
- Empty states should use readable text contrast and not rely on color alone.
- Focus visibility must not be removed.

## Responsive Behavior

- Desktop: summary header spans the page; performance/log panels sit side by side.
- Tablet/mobile: panels stack vertically with consistent spacing.
- Player chips wrap without overlap.
- Stat rail should collapse cleanly without causing horizontal overflow.

## Verification Plan

- Run focused lint for edited files.
- Run TypeScript check.
- Browser-verify `http://localhost:3000/players/nick-daicos-collingwood`.
- Confirm:
  - page identity is correct;
  - player summary renders above the fold;
  - no page error overlay appears;
  - no `Failed to load match history` copy appears for valid empty match logs;
  - `Refresh Data` remains clickable;
  - desktop and mobile viewports do not overlap or overflow.

## Approved Direction

Approved direction: **A. Balanced profile dashboard**.

Approval source: user approval in Codex on 2026-06-28 after viewing the visual companion mockup at `http://localhost:56132/`.

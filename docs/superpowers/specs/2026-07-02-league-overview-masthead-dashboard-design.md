# League Overview Masthead Dashboard Design

## Context

The current League Overview tab is useful but visually bland. Previous iterations improved data coverage and removed the bottom next-action block, but the screen still reads as a set of similar rounded cards. The user described the result as bland and too same-same.

The selected visual direction is **A. Masthead Dashboard** from the browser companion session on July 2, 2026.

## Goal

Make the League Overview tab feel like a polished overview/dashboard without becoming intense or broadcast-like.

The design should:

- Replace the repetitive top card grid with a stronger league masthead module.
- Keep the screen calm, readable, and operational.
- Reduce the cream/tan “desert” feel by using cooler neutral surfaces inside the overview.
- Preserve the existing data: league team count, trade offers, scoring categories, current user team, waiver position, draft status, and team preview.
- Keep commissioner actions accessible through existing tabs and buttons.

## Chosen Direction

Use a masthead dashboard composition:

- A dominant league overview panel at the top.
- Embedded key metrics inside that panel instead of four equal standalone tiles.
- A compact side stack for “Your team” and “Waiver position”.
- A structured team preview table beneath the masthead.
- Secondary trade, waiver, and draft detail modules below only where they add useful information.

This should feel like a designed dashboard page rather than a collection of isolated cards.

## Visual Principles

- Use cooler neutral surfaces: white, near-white, blue-grey, and the existing navy primary.
- Avoid tan/brown emphasis in the overview content.
- Use one strong dark/navy anchor panel for hierarchy, not a fully dark interface.
- Keep border radius moderate and consistent.
- Use thin dividers and table rows for dense information instead of boxing every value.
- Use chips sparingly for state, not decoration.
- Keep typography quiet but intentional: strong title, compact labels, clear metric values.

## Layout

1. Masthead module:
   - Left: dark/navy league identity panel with league name, privacy/team/draft summary, and three embedded metrics: teams, trade offers, categories.
   - Right: two stacked modules for current user team and waiver position.

2. Team preview:
   - Directly below masthead inside the same visual group.
   - Header row with columns: Team, Role, Status.
   - Show top active teams from existing overview data.
   - Keep the existing “View teams” action.

3. Supporting modules:
   - Trade offers and waiver position remain available below the masthead group.
   - Draft status remains visible, but not as a generic next-action callout.
   - No bottom “Next action” section.

## Data Boundary

Stay inside `src/components/league/LeagueTabs.tsx`.

Reuse existing derived values:

- `activeMembers`
- `openTeamSlots`
- `waiverPriorityLabel`
- `waiverPolicyLabel`
- `overviewTrades`
- `overviewTradesStatus`
- `overviewTeams`
- `categorySummary`
- `draftReadiness`
- `isDraftComplete`

No backend/API changes are needed.

## Accessibility

- Preserve semantic `section`, `h2`, `button`, and table-like row structure.
- Keep keyboard focus states on interactive controls.
- Avoid relying on color alone for status; keep text labels.
- Ensure contrast in the navy masthead is sufficient.

## Testing And Verification

Update focused unit coverage only where structure/copy changes:

- Overview still shows the league snapshot/dashboard content.
- Teams, waiver priority, pending trades, scoring, and team preview remain present.
- `Next action` remains absent.

Run:

- `npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.draftActions.test.tsx`
- `npx eslint src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.draftActions.test.tsx`
- `npm run typecheck`
- Browser render verification at the active league overview route.

## Out Of Scope

- Global theme replacement.
- New dependencies.
- Backend data model changes.
- Reworking other league tabs.
- Reintroducing a bottom next-action panel.

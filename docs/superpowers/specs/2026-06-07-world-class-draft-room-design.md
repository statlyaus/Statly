# World Class Draft Room Design Spec

Date: 2026-06-07

Council gate: `CHAIRMAN DECISION 1: PROCEED`

Status: Design approved for specification. Implementation must wait for an approved execution plan.

## Purpose

The draft room work is unfinished until this design lands as the single current target. The prior draft-room branch and PR #416 are reference material only; they must not be treated as a complete product version or integrated into main as a separate layout.

This spec defines the consolidated Statly draft room: a live fantasy draft board, a functional pick/timer surface, roster/queue/watchlist controls, player rows with team logos, cleaner league-stat display, and a dynamic league-category `Statly Z` score.

## Research Baseline

The target is an ESPN/Sleeper/NFL-style live draft room adapted to Statly's AFL category leagues, not a generic dashboard.

Relevant patterns reviewed:

- ESPN Fantasy supports a draft player queue, including automatic drafting from the queue when autopick is active: <https://support.espn.com/hc/en-us/articles/360000991011-Online-Draft-Player-Queue>
- Sleeper treats snake drafts as the default draft format and emphasizes live draft boards, queue preparation, and timer control: <https://support.sleeper.com/en/articles/9701062-what-draft-types-are-supported> and <https://sleeper.com/draftboard>
- NFL Fantasy documents a draft client with draft order, timer, stats, analysis, queue, selected-player history, team rosters, and league chat: <https://support.nfl.com/hc/en-us/articles/35869693560980-The-Basics>

Statly should keep the dense, operational feel of those draft rooms while improving clarity for AFL category leagues and preserving shadcn-style composition.

## Approved Layout

The desktop draft room uses three persistent work zones under a top draft board:

1. Top: horizontal pick train and live pick/timer surface.
2. Left: roster, queue, and watchlist rail.
3. Center: available player market.
4. Right: pick feed and draft activity.

The layout should feel like the supplied ESPN reference: draft progress is always visible, player selection remains the center of gravity, and roster/queue/activity are visible side rails instead of hidden afterthoughts.

### Top Pick Train

The top board is the main draft component. It replaces the current isolated banner with a real working pick design.

Required behavior:

- Show completed picks, current pick, upcoming picks, round separators, and the user's next pick.
- Make the current pick visually dominant with timer, team name, pick number, round, and on-clock state.
- Show manual/autopick readiness when known.
- Show completed picks with player name, team/club logo, position, picking fantasy team, overall pick, and round.
- Show upcoming picks with fantasy team, pick slot, round, and "your pick" emphasis where relevant.
- Keep the timer colocated with the current pick so users never scan away from the active decision.
- Handle scheduled, waiting-room, live, paused, and complete states without switching to a different visual system.

The pick train consumes normalized draft state. It must not duplicate snake-order rules or independently invent pick state if a shared draft helper already owns that logic.

### Left Rail

The left rail has three switchable modes:

- `Roster`
- `Queue`
- `Watchlist`

Default mode is phase-aware:

- Before the draft starts, default to `Queue`.
- Once the draft is live, default to `Roster`.
- If the user chooses a mode manually, persist that choice for the session and do not snap back after each pick.

Required behavior:

- `Roster` shows filled slots, empty slots, bench, and position coverage using the league roster settings.
- `Queue` shows queued players in priority order and supports reorder/remove actions.
- `Watchlist` shows watched players and marks drafted/unavailable players clearly.
- Queue and watchlist counts remain visible on the mode switcher.
- Queue stays available as the autopick safety rail even when `Roster` is selected.

### Center Player Market

The center column is the primary player-selection table.

Required behavior:

- Player rows include player name, position, AFL club, and AFL club logo next to the name.
- Search supports player name, position, and club.
- Filters include position and any existing relevant league/player filters.
- Sort includes `Statly Z`, ADP/rank where available, name, position, club, and visible league categories.
- Actions include watch, queue, and select/draft with disabled states for unavailable players.
- Selection action must reflect whether the current user is on the clock.
- Rows must stay dense, readable, keyboard accessible, and responsive.

### Right Pick Feed

The right rail is a live feed for draft context, not a decorative panel.

Required behavior:

- Show recent picks in reverse chronological order.
- Show activity filters for all activity, picks, messages, and watchlist/queue alerts where supported.
- Show pick cards with player, logo, position, selecting fantasy team, round, pick number, and time.
- Surface "watched player drafted" and "queued player drafted" alerts.
- Keep feed visible on desktop and available through a mobile drawer or tab.

## Statly Z Score

The primary player-value metric is `Statly Z`.

Expanded label: `Statly Z Score`

Tooltip/help text: `Combined Z score across this league's selected scoring categories.`

Rules:

- Do not label this metric as "Fantasy avg" or "Fantasy average".
- Do not hard-code "9-category" wording. The category count comes from the league's selected scoring categories.
- Do not assume the nine-category preset is fixed for every league.
- The visible category columns are generated from the league scoring settings.
- If the league's selected categories change before the draft starts, `Statly Z`, sorting, and category columns update from that source of truth.
- If selected categories are missing or pending, show `Statly Z pending` or `League categories pending`, not a fake average.
- If a player lacks data for a selected category, use a deliberate missing-data treatment that does not silently inflate or hide the score.

The calculation should be owned by a shared scoring/ranking boundary, not by table markup. The UI receives the combined score, selected category list, and per-category display values.

## Component Ownership

Implementation should integrate into the main draft room route and component tree. Do not create another standalone draft-room version.

Expected ownership boundaries:

- `DraftProvider` or equivalent draft context owns draft phase, connection state, selected categories, available players, queue, watchlist, rosters, picks, current pick, current user/team, and mutation affordances.
- A top-board component consumes draft state and renders the pick train, current timer, round breaks, current pick, next user pick, and final/complete state.
- A left-rail component owns the roster/queue/watchlist mode UI and persists the user's mode choice for the session.
- The player market table owns search, filters, sorting, row rendering, and draft/watch/queue actions using data supplied by the draft context.
- The pick feed owns recent picks, activity filters, and alert presentation.
- Shared scoring/ranking code owns `Statly Z` inputs and output.
- API routes remain transport adapters over shared server logic; they should not become the product source of truth for draft rules.

## Data Requirements

The draft room needs one normalized read model with:

- Draft identity, phase, pause state, start time, round, pick number, and timer metadata.
- Draft order with fantasy team ids, fantasy team names, pick slots, and user ownership.
- Completed picks with player, AFL club, player position, selecting fantasy team, round, pick number, and timestamp.
- Current pick with on-clock team, timer expiry, autopick/manual state, and whether the viewer can select.
- Upcoming picks with current user's next pick marked.
- League roster settings and current roster slots.
- Queue and watchlist lists scoped to the authenticated team.
- Selected league scoring categories and category display metadata.
- Player ranking rows with `Statly Z`, category values, AFL club logo, availability, and action permissions.

All optional or legacy data should be normalized before rendering. Rendering components should not compensate for inconsistent draft shape with ad hoc fallbacks.

## Visual Standard

Follow Statly's shadcn/ui principles:

- Use semantic theme tokens such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, and `border-border`.
- Preserve light and dark mode.
- Prefer small composed components over one monolithic draft-room wrapper.
- Use existing button, tab, table, tooltip, badge, drawer, and scroll-area patterns where they fit.
- Keep density high enough for a real draft room.
- Avoid marketing-page layout, oversized cards, ornamental gradients, and mixed legacy style systems.

The visual companion artifacts used during brainstorming are reference only:

- `draft-room-layout-directions.html`
- `draft-room-layout-a-refined.html`
- `draft-room-espn-inspired-statly.html`
- `draft-room-left-rail-behavior.html`
- `draft-room-league-z-score.html`

These files are not product implementation and should not be merged as app code.

## Accessibility

Required accessibility behavior:

- All tabs, filters, sorting controls, row actions, and pick-feed filters are keyboard accessible.
- Icon-only buttons have accessible names.
- Timer state is understandable without relying only on color.
- Current pick and user's next pick are announced with text labels.
- Disabled draft actions explain why selection is unavailable.
- Focus remains stable when picks update in realtime.
- Mobile drawers/tabs trap and restore focus correctly.

## Responsive Behavior

Desktop:

- Top pick train remains fixed or sticky within the draft-room shell.
- Left rail, center player market, and right feed are visible together when width allows.

Tablet:

- Left rail remains available; right feed may collapse behind an activity button if space is constrained.
- Player table keeps the most important columns visible: player, `Statly Z`, position/club, and actions.

Mobile:

- Top current pick/timer remains visible.
- Player market is the default live interaction surface.
- Roster/queue/watchlist and pick feed are accessible through drawers or tabs.
- The user's persisted rail choice still applies when returning to a wider viewport in the same session.

## Verification Targets

Implementation is not done until these pass:

- Browser verification for scheduled, waiting-room, live, paused, and complete draft states.
- Browser verification that pre-draft default rail is `Queue`.
- Browser verification that live draft default rail is `Roster`.
- Browser verification that manual rail choice persists during live pick updates.
- Browser verification that player rows show AFL club logos next to names.
- Browser verification that the top pick train shows completed, current, upcoming, and user's next pick states.
- Browser verification that timer, on-clock team, and select/draft action agree.
- Browser verification that right feed updates after a pick.
- Unit or integration coverage for dynamic league-category `Statly Z` inputs.
- Type/lint checks for the changed component tree.
- Council Decision 2 before committing implementation.

## Non-Goals

This spec does not approve:

- A standalone demo draft room as the final implementation.
- Another parallel version beside the main draft route.
- A fixed nine-category assumption for all leagues.
- Cosmetic-only styling without a working pick train, timer, roster, queue, watchlist, player table, and feed.
- A commit that calls the design complete without browser verification.

## Done Definition

The draft room design is complete only when the main draft route provides one consolidated, working experience:

- The pick train and timer are live and understandable.
- Roster, queue, and watchlist are integrated in the left rail with correct defaults and persisted user choice.
- Player rows include AFL club logos and clean league-stat presentation.
- `Statly Z` is calculated from the league's selected scoring categories.
- The pick feed provides useful live draft history and alerts.
- The app no longer has mixed competing draft-room versions.
- The implementation is verified in browser and approved by council before commit.

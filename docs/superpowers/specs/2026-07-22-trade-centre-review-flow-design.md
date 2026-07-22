# League Trade Centre Review Flow Design

Date: 2026-07-22

Status: Approved design

Selected direction: Approach A — composed two-step workspace

## Goal

Turn the embedded league Trade Centre into a confident sports-analysis workspace that supports fast roster comparison and a deliberate proposal confirmation step.

The design must:

- preserve side-by-side roster evaluation on desktop;
- present both trade sides symmetrically;
- make dense player and category data easier to scan;
- keep the selected package and next action visible;
- require an explicit client-side review before submission;
- work as a focused Send/Receive roster switch on mobile;
- preserve the existing proposal API, trade lifecycle, category arithmetic, and persistence.

## Non-goals

- Persisting trade drafts or adding URL-backed draft state.
- Changing trade validation, limits, deadlines, review policy, or lifecycle rules.
- Changing category calculations from per-player per-game averages.
- Claiming server validation before the proposal is submitted.
- Inferring player availability or health from missing data.
- Claiming starter, bench, lineup legality, or projected scoring consequences without an authoritative server projection.
- Redesigning the global Statly header or league navigation.

## Approved Product Decisions

1. Composition uses symmetric team-relative labels: `{teamName} sends` for both panels.
2. The edit screen uses neutral white or cool-grey roster surfaces with restrained Statly-blue accents.
3. Green and red are reserved for calculated favourable and unfavourable category impact.
4. Amber is reserved for warnings.
5. The review step is client-local. Only its final **Send proposal** action calls the existing proposal callback.
6. The persistent tray says **Ready to review**, not **Trade valid**, because server validation remains authoritative.
7. Injury and availability indicators are deferred until authoritative data is added to the Trade Centre read model.
8. Position consequences are neutral package deltas only. They are not lineup-validity or projected-lineup claims.

## Information Hierarchy

The screen has four visual levels:

1. **Trade context** — team eyebrow, 28–32px Trade Centre title, description, deadline, expiry, review mode, and trade limit.
2. **Partner and package builder** — partner selection and two equivalent roster panels.
3. **Package analysis** — persistent selection tray followed by category impact.
4. **Existing offers** — Inbox, Sent, History, and Review remain below the composer.

Typography and geometry:

- Page title: 28–32px, semibold or bold.
- Section titles: 16–18px.
- Player names and statistics: at least 14px.
- Supporting metadata: 12–13px with WCAG AA contrast.
- Major controls and actions: at least 44px high.
- Roster rows: approximately 52–56px.
- Checkboxes: 18–20px.
- Visible focus treatment: 3px.

## Component Architecture

### `TradeComposer`

`TradeComposer` remains the single owner of the proposal draft. It orchestrates edit and review views, derives viewer and partner teams, validates selection completeness, manages focus transitions, and invokes the existing `onSubmit` callback only from review.

It receives trade rules from `LeagueTradeCentrePanel` so the review view can state the league deadline and relative offer-expiry policy without creating a proposal early.

### `tradeComposerState`

A pure reducer owns:

- partner member ID;
- sending player IDs;
- receiving player IDs;
- optional message;
- active mobile roster side;
- `edit | review` step.

Actions:

- `selectPartner`;
- `toggleSendingPlayer`;
- `toggleReceivingPlayer`;
- `clearSelections`;
- `setMessage`;
- `showRoster`;
- `review`;
- `edit`;
- `reset`.

Changing the partner clears only the incoming package and returns the composer to edit mode. A successful proposal resets the draft. A failed proposal preserves the complete review draft.

Selectors derive:

- total selected count;
- whether both packages contain at least one player;
- selected player objects;
- neutral position counts and deltas.

### `TradeRosterWorkspace`

The workspace renders the two structurally identical team panels.

Desktop and wide tablet:

- two equal-width panels;
- `{teamName} sends` headings;
- equal team identity, selected count, search, table, and scroll behavior.

Mobile:

- a 44px Send/Receive segmented control;
- `aria-pressed` or equivalent selected-state semantics;
- one roster panel in the DOM presentation at a time;
- selections persist when switching sides;
- labels and counts remain visible in each control.

The switch controls visibility only. It does not create duplicate roster state.

### `TradeRosterTable`

The table remains semantic and dense.

Each row includes:

- AFL club mark from the existing team-logo utility;
- player name;
- clear position badge;
- club identity;
- current league-driven category averages.

Interaction rules:

- pointer activation anywhere on a non-interactive part of the row toggles selection;
- the native checkbox remains the keyboard and screen-reader selection control;
- checkbox clicks must not double-toggle through row bubbling;
- selected state uses a checkmark, `aria-selected`, a leading accent, and a subtle blue-neutral background;
- row height does not change when selected.

Table rules:

- 52–56px player rows;
- 44px minimum sort targets;
- 14px tabular numeric values;
- sticky category header and sticky player identity column;
- visible sort state text such as `A–Z`, `High–low`, or `Low–high`;
- full category names exposed through accessible tooltip content and control labels;
- internal horizontal scrolling with no page-level horizontal overflow.

### `TradeSelectionTray`

The tray is sticky within the composer rather than globally fixed.

It shows:

- total selection count;
- `Select from both teams` or `Ready to review`;
- **Clear**;
- **Review trade**.

The status is announced through a polite live region. The tray respects safe-area insets on mobile and must not obscure the active row, comparison content, or validation errors.

### `TradeReviewStep`

The review step contains:

- compact **You send** and **You receive** package summaries;
- category-impact summary and detailed table;
- explicit basis: season average per selected player, per game;
- neutral position-count changes for both packages;
- optional message;
- league deadline;
- `Expires N hours after sending` policy;
- **Back to edit**;
- final **Send proposal**.

Entering review moves focus to the review heading. Returning to edit restores focus to **Review trade**. Submission errors remain visible in review and do not discard selections or message text.

### `TradeComparisonTable` and `tradeComparison`

The existing average and lower-is-better arithmetic remains unchanged.

A pure summary helper counts:

- gained/favourable categories;
- lost/unfavourable categories;
- even categories;
- unavailable categories.

The comparison presentation becomes:

- `Category impact: N gained · N lost · N even`;
- team-name columns instead of generic send/receive labels;
- one combined **Impact** column containing signed difference, direction icon, and text;
- one compact legend explaining that category direction is normalized;
- no repeated “higher/lower is better” text in every visible row;
- tooltip and accessible names retain the original category direction;
- green/red never acts as the only outcome indicator.

## Data Boundary

Safe existing fields:

- fantasy-team name and logo URL;
- viewer-team identity;
- player name, AFL club, and position;
- league-driven statistic columns, labels, abbreviations, and direction;
- current roster ownership;
- review mode, trade limit, deadline, and offer-expiry hours;
- exact expiry and review timestamps for persisted offers.

Safe derived presentation:

- selected package counts;
- category-impact counts;
- neutral position counts and deltas;
- relative pre-send expiry wording.

Deferred until authoritative data exists:

- injury or health status;
- “available” status;
- starter or bench consequences;
- current lineup assignment effects;
- lineup legality;
- projected scoring impact;
- exact pre-send expiry timestamp.

## Validation and Errors

- Review is disabled until each team contributes at least one selected player.
- Attempting to advance with an incomplete package exposes an inline error associated with the tray status.
- Partner changes clear incoming selections and return to edit mode.
- API and conflict errors remain owned by the existing submission boundary.
- A failed submission preserves the review draft.
- Successful submission resets local state and follows the existing refresh behavior.

## Accessibility

- Preserve semantic table headings, captions, `aria-sort`, and row selection state.
- Keep native checkboxes as the keyboard selection mechanism.
- Ensure row pointer behavior never replaces the checkbox’s accessible name or state.
- Use complete category labels in tooltip and screen-reader content.
- Announce selection count and readiness changes.
- Provide 3px focus indicators and logical focus restoration between edit and review.
- Associate validation errors through `aria-invalid` and `aria-describedby` where applicable.
- Verify the mobile switch with keyboard and screen-reader semantics.
- Verify horizontal scroll regions, sticky content, and 200% zoom without page overflow.

## Responsive Behavior

- 1920/1440px: centred 96rem workspace, side-by-side rosters, sticky tray.
- 1024px: side-by-side only when both player identity columns remain usable; otherwise switch to the mobile-style roster control.
- 390px: Send/Receive switch, one visible roster, full-width tray action, internal table scrolling.
- The existing league navigation may scroll horizontally.
- No breakpoint may create page-level horizontal overflow.

## Verification

Automated checks:

- reducer tests for initialization, partner changes, clear/reset, mobile side, and edit/review transitions;
- component tests for row-pointer selection and native-checkbox keyboard selection without double toggles;
- mobile switch tests showing preserved selections and unique control IDs;
- review tests proving **Review trade** makes no network request;
- final submission tests proving only **Send proposal** calls the existing callback;
- Back-to-edit persistence for selections and message;
- comparison-summary tests for higher-is-better, lower-is-better, even, and unavailable categories;
- existing average-not-total tests remain green;
- focused lint, typecheck, and production build.

Browser checks:

- 1920, 1440, 1024, and 390px;
- 200% zoom;
- no page-level horizontal overflow;
- sticky tray does not obscure content;
- keyboard-only edit → review → edit → submit journey;
- visible focus, tooltip access, mobile switching, sorting, and horizontal table scrolling;
- before/after screenshot comparison at matching viewports.

## Residual Risk

The existing Trade Centre has no authoritative injury/availability or lineup projection data. Those requested ideas are deliberately excluded rather than approximated. A future feature should extend a shared server-side trade projection/read model before presenting those claims.

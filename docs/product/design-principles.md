# Product design principles

Statly should feel unmistakably AFL while meeting the clarity and task speed expected from mature
fantasy products. Use ESPN Fantasy as a benchmark for structured tables and roster management,
SuperCoach for AFL statistical depth, and Yahoo Fantasy for approachable mobile draft/trade flows.
These are quality references, not assets or layouts to copy.

The [style guide](style-guide.md) is the reference for owner decisions, tokens, type, components and
copy; this page holds the principles behind them.

## Product hierarchy

- Lead with the user's current decision: pick, set lineup, compare matchup, claim, trade, or administer.
- Make league, season, round, and role context visible before destructive or consequential actions.
- Prefer one clear page title, short purpose line, primary action, and consistent content container.
- Keep dense fantasy data scannable with stable identity columns, aligned numeric columns, meaningful
  abbreviations, and progressive detail.
- Use authentic AFL club/player context without allowing decoration to compete with decisions.

## Design system

- Reuse open-code shadcn-style primitives and existing composition patterns.
- Use semantic theme tokens rather than fixed palette utilities in product markup.
  `node Scripts/design/count-raw-colours.mjs --top 15` lists the files that still use raw palette
  classes or colour literals; once a file is clean, add it to `tests/unit/designTokenColours.test.ts`
  so it cannot regress.
- Statly is light only (owner, 2026-11-19). Do not add `dark:` utilities or a dark theme.
- Keep spacing, radius, typography, and elevation consistent with existing tokens.
- Type is Geist for display and UI, Saira for reading and table numbers, and Caveat for hand notes
  (owner, 2026-11-19): `font-display` is Geist, `font-sans` is Saira and `font-hand` is Caveat, all
  loaded in `src/app/layout.tsx`. Numbers are tabular
  across the app so stats line up in columns.
- Navigation icons come from `StatlyIcon` (`src/components/ui/StatlyIcon.tsx`): stroke-only,
  `currentColor`; the glyphs are being redrawn as the hand-drawn marker set in the
  [style guide](style-guide.md#icons) (target, phase 5). Each animates when its link or button is
  hovered or focused and once for the current page (`aria-current="page"`), and stays still under
  reduced motion. Add a glyph there rather than inlining another SVG in a nav item.
- Add a new abstraction only when immediate reuse exists; fix the owning shared primitive when a shared
  behavior is wrong.

## Accessibility

- Use semantic HTML and visible labels or accessible names for every control.
- Preserve keyboard operation, focus visibility, focus movement/restoration, and screen-reader state.
- Associate validation/help text with its field and expose invalid state programmatically.
- Do not rely on color alone for status, send/receive direction, category winner, injury, or lock state.
- Respect reduced-motion preferences and maintain readable reflow at zoom.

## Responsive behavior

Managers must be able to complete core tasks at a 390px phone width without document-level horizontal
overflow, clipped actions, or one-word columns. Large tables may scroll inside a clearly bounded region
while identity and action context remain discoverable.

Full-screen draft/broadcast experiences can opt out of the standard shell, but that ownership must be
explicit at the route/layout boundary. Do not make each page remember to reconstruct a shared shell.

The shell (`src/components/navigation/AppLayout.tsx`) owns the landmarks: the header's primary links
sit in `<nav aria-label="Main">`, and the shell renders the page's only `<main id="main-content">`,
which the skip link targets. Pages under `src/app/(app)` wrap their content in a `<div>` or
`<section>`, never `<main>`; `tests/unit/app-shell-landmarks.test.tsx` enforces this. Only an
immersive route that skips the shell, such as the live draft room, renders its own `<main>`.

## Realtime and data-rich UI

- Distinguish persisted state, pending mutation, reconnecting/catching-up state, and failure.
- Do not imply a pick, trade, waiver, or lineup save succeeded before server confirmation.
- Keep timestamps deterministic and show the relevant league timezone. League times (draft starts,
  picks, lineup locks, matchup starts, waiver runs and claims) go through `formatLeagueTime` in
  `src/lib/leagueTime.ts`, which formats in the league's `LeagueSettings.timeZone` and always prints
  the zone abbreviation. Relative times ("3m ago") and real AFL fixture times are not league times.
- Explain comparison bases, sample sizes, directionality, and limitations; do not label an estimate as
  objective fairness.
- Use loading, empty, error, unauthorized, and stale-data states deliberately.

## Sports presentation

Follow the conventions managers already read on AFL.com.au, ESPN and Yahoo rather than generic
dashboard patterns.

- Chrome: the fantasy app uses a solid `brand-bar` header with high-contrast navigation and a filled
  active item. The public site (owner, 2026-11-18) uses a white header: the "Statly." wordmark, a
  thin divider, then text tabs, the current one semibold with an underline on the header's bottom
  border in the brand colour (cobalt from phase 3 of the style guide); the footer is `brand-bar`. Content sits in white cards on a light page, never on
  decorative gradients or photography.
- Story surfaces are the exception (owner, 2026-11-16): the public home page hero and `/afl/stories`
  pages use the owner's collage designs. Club colours only, no club or league marks and no press
  photography. Sketches are original; a generated illustration shows invented people, never a real
  player, and carries no caption (owner, 2026-11-17). Build these from the owner's design export,
  not from a description.
- Scores lead: a quiet round and status line (Live, Final, start time), team marks on either side,
  large tabular numerals, one plain-language result line, and a box score with the real category
  values. Restraint over decoration: no hanging tabs, glows or oversized badges.
- Identity beside every team name: logo or initials, and the record where it is known.
- Tables and ladders: fixed row heights, a position column, the user's row highlighted, the key
  column emphasised, and short condensed section titles.
- LIVE status uses the `status-live` token, never a result token, so a live match is not read as a loss.
  Unread counts use the `primary` token (cobalt from phase 3; sun on the cobalt app bar).
- Results use the `resultTone` recipe (win solid cobalt, loss a white chip with an ink edge, draw
  stone) and always carry a letter or symbol (W, L, D) so meaning never depends on colour. Errors use
  `destructive` and success uses `success`, never a result token.
- Show real state only. Omit a module rather than fill it with estimates or placeholder numbers.
- One palette. Area tokens such as `--trade-*` alias the core tokens (the league palette was folded
  into the core tokens on 2026-11-22); no area gets its own colour scheme, card shadow or accent.
  Primary actions and focus use the brand colour (cobalt `brand-bar`). The one exception is
  the warm paper surface mode on public trade pages (owner, 2026-11-19), which redefines the core
  roles rather than adding a palette.
- Section navigation is one row of underlined tabs with a thin divider between groups, never pills
  or uppercase group labels. Each page opens with a plain heading, not a coloured hero block.

## Review evidence

Product-level UI changes should include:

- before/after screenshots or video for affected states;
- desktop and 390px browser evidence;
- keyboard/focus and accessible-name checks for changed interactions;
- console and hydration review;
- focused tests plus lint/typecheck; and
- an explicit note for states that could not be reproduced.

Use `.agents/skills/product-design-review/SKILL.md` to run this review. Historical screenshots and
one-time audit reports belong in the pull request, not as permanent repository documentation.

# Product design principles

Statly should feel unmistakably AFL while meeting the clarity and task speed expected from mature
fantasy products. Use ESPN Fantasy as a benchmark for structured tables and roster management,
SuperCoach for AFL statistical depth, and Yahoo Fantasy for approachable mobile draft/trade flows.
These are quality references, not assets or layouts to copy.

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
- Preserve light/dark behavior supported by the surrounding surface.
- Keep spacing, radius, typography, and elevation consistent with existing tokens.
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

## Realtime and data-rich UI

- Distinguish persisted state, pending mutation, reconnecting/catching-up state, and failure.
- Do not imply a pick, trade, waiver, or lineup save succeeded before server confirmation.
- Keep timestamps deterministic and show the relevant league timezone.
- Explain comparison bases, sample sizes, directionality, and limitations; do not label an estimate as
  objective fairness.
- Use loading, empty, error, unauthorized, and stale-data states deliberately.

## Sports presentation

Follow the conventions managers already read on AFL.com.au, ESPN and Yahoo rather than generic
dashboard patterns.

- Chrome: a solid `brand-bar` header with high-contrast navigation and a filled active item; content
  sits in white cards on a light page, never on decorative gradients or photography.
- Scores lead: a quiet round and status line (Live, Final, start time), team marks on either side,
  large tabular numerals, one plain-language result line, and a box score with the real category
  values. Restraint over decoration: no hanging tabs, glows or oversized badges.
- Identity beside every team name: logo or initials, and the record where it is known.
- Tables and ladders: fixed row heights, a position column, the user's row highlighted, the key
  column emphasised, and short condensed section titles.
- Results use the `result-win`, `result-loss` and `result-draw` tokens and always carry a letter or
  symbol (W, L, D) so meaning never depends on colour.
- Show real state only. Omit a module rather than fill it with estimates or placeholder numbers.
- One palette. Area tokens such as `--league-*` and `--trade-*` alias the core tokens; no area
  gets its own colour scheme, card shadow or accent. Primary actions and focus use the navy
  `brand-bar`.
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

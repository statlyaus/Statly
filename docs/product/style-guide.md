# Style guide

The rules every Statly screen follows, on both the fantasy app and the public AFL Draft and Trade
Outcomes site. [Design principles](design-principles.md) says what good looks like; this guide is the
reference: owner decisions, tokens, type, components and copy. Where a rule is marked **target**, new
code follows it now and existing code moves to it in the phase named under
[Enforcement](#enforcement). Rules with no marker are already how the code works.

Agents: read the [Rules for agents](#rules-for-agents) section before touching UI or user-facing
strings.

## Rules for agents

- MUST use semantic token utilities (`bg-background`, `text-muted-foreground`, `border-input`). NEVER
  palette classes (`text-gray-500`, `bg-blue-600`), hex in `className` or `style`, or a new area
  palette.
- MUST use `buttonStyles`, `badgeStyles` and `fieldStyles` from `src/components/ui/controlStyles.ts`.
  NEVER a bare styled `<button>`, `src/components/Button.tsx` or `ui/Badge.tsx` in new code.
- MUST use Saira (`font-sans`) and Saira Extra Condensed (`font-display`). NEVER load another font
  outside the story collage exception. NEVER set text below 11px.
- MUST write sentence case, Australian English, and the copy patterns under [Content](#content).
  NEVER "successfully", "please", "sorry", "oops" or an exclamation mark in system messages.
- MUST format dates, times and numbers with an explicit `en-AU` locale; league times go through
  `formatLeagueTime`. NEVER a bare `toLocaleString()`.
- MUST give every status a word or letter as well as a colour (W, L, D, Live, Provisional).
- MUST keep keyboard access, a visible focus ring, accessible names, 44px touch targets on phones and
  390px reflow.
- NEVER add a dark theme or `dark:` utilities.

## Owner decisions

Recorded 2026-11-19 from the style guide research unless another date is given.

| Topic                             | Decision                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme                             | Light only. The unused `.dark` tokens and `dark:` utilities are deleted (target, phase 3).                                                 |
| Typefaces                         | Saira and Saira Extra Condensed on both surfaces (owner's pick, 2026-11-08).                                                               |
| Warm trade palette                | Kept as an official surface mode, `data-surface="paper"`, replacing the `--ts-*` namespace (target, phase 3).                              |
| Trade verdicts                    | Public trade pages show values, not letter grades or verdict labels (as built for #789).                                                   |
| Accent blue                       | One accent, `#185fa5` (6.52:1 on white). Navy `#0f2a44` stays the brand colour. `--statly-blue` and `text-blue-700` retire (phase 3).      |
| Two-club charts                   | Side hues (`--side-a` blue, `--side-b` vermilion) plus a club chip. Guernsey colours stay for single-club views and identity marks.        |
| Match results                     | Green win, red loss, grey draw, always with W, L or D.                                                                                     |
| Logo                              | One SVG source: the text wordmark on white headers and a reversed lockup on navy. Unused logo files are deleted (phase 5).                 |
| Story collage                     | Permanent exception, scoped to the home hero and `/afl/stories` (owner, 2026-11-16). Its stylesheets may use literals; counted separately. |
| Time zones and stat abbreviations | AEST or AEDT by date, as `formatLeagueTime` prints. One Statly abbreviation table beside `src/types/fantasyCategories.ts` (phase 5).       |

## Tokens

All tokens live in `src/index.css` (Tailwind v4, `@theme inline`, no JavaScript config).

- **Two tiers.** Primitives (raw values) live in plain `:root` and generate no utilities. Semantic roles
  (`--background`, `--foreground`, `--muted-foreground`, `--input`, `--primary`, `--ring`,
  `--result-win`, `--status-live` and so on) are the only names components use, exposed through
  `@theme inline`.
- **Area palettes collapse (target, phase 3).** A `--league-*`, `--trade-*` or `--social-*` token that
  only aliases a core role is deleted and its call sites use the core utility. Tokens with a recorded
  reason stay and are registered in `@theme`, so `text-[color:var(--league-text-muted)]` becomes
  `text-league-text-muted`.
- **Surface modes, not namespaces.** The paper mode redefines the semantic roles on its root element;
  components inside it use the same utilities as everywhere else.
- **No JSON token pipeline.** The CSS file is the only source. Revisit only if a second consumer
  (native app, Figma, generated images) needs the values.

### Colour roles

Every pair below must hold in every surface mode. Ratios are WCAG 2.2 contrast ratios.

| Role                    | Rule                                                               | Status                                                               |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Body text               | At least 4.5:1                                                     | `#2b2c2d` on white is 13.99:1                                        |
| Small labels (11–12px)  | At least 5.5:1                                                     | Target: `muted-foreground` on `muted` is 4.86:1; raise it in phase 3 |
| `--input` (field edge)  | At least 3:1 against its surface (WCAG 1.4.11)                     | Fails: `#ced4da` is 1.49:1 on white. Candidate `#80868d` is 3.68:1   |
| `--border` (decorative) | No minimum; never the only edge of a control                       | `#ced4da`                                                            |
| Brand                   | Navy for chrome, primary buttons and focus on light surfaces       | `#0f2a44` on white is 14.63:1                                        |
| Accent and links        | The one accent blue                                                | `#185fa5`: 6.52:1 on white, 6.25:1 on paper                          |
| Results                 | Green, red, grey, always with W, L or D                            | Existing tokens pass with white text                                 |
| Live                    | `--status-live`, always with the word "Live", never a result token | Exists                                                               |
| Provisional             | `--status-provisional`, always with the word "Provisional"         | Target, phase 3                                                      |
| Trade sides in charts   | `--side-a` and `--side-b`, never good/bad colours                  | Target, phase 3                                                      |
| Chart categories        | Each hue at least 3:1 against the surface, or outlined             | Target: the current `--chart-*` values are untested shadcn defaults  |

A trade has two sides, not a good side and a bad side: trade charts never use green and red.

### Type

- Saira for text, Saira Extra Condensed for headings and scores (uppercase by the base layer; add
  `normal-case` to opt out). `body` sets tabular numerals; display headings switch to proportional
  numerals (target, phase 3).
- Keep Tailwind's size scale. One added token, `text-label` (11px, 16px line height, semibold,
  uppercase, 0.08em tracking), replaces the bracketed 11px sizes and one-off letter-spacing values
  (target, phase 3). Nothing smaller than 11px.
- `uppercase` only on `text-label` and `font-display`, never on navigation or group headings.

### Space, shape, elevation, motion and focus

- Spacing stays on Tailwind's 4px scale. No arbitrary pixel spacing or widths; layout constants are
  named `:root` tokens.
- Three radii: square badges, 4px controls, 8px cards and panels.
- Cards are flat with a border. One shadow, for popovers, menus and dialogs.
- Movement sits under `motion-safe:`; the global reduced-motion rule and `MotionConfig` stay.
- One focus rule: a 2px navy outline offset by 2px, white inside navy bars. Sticky headers set
  `scroll-padding-top` so focus is never hidden behind them.
- Targets at least 24px; primary touch controls 44px on phones, including the app nav.

## Components

One primitive per job, in `src/components/ui/`.

- **Buttons:** `buttonStyles` only. Icon-only buttons need an accessible name.
- **Badges:** `badgeStyles` only, square.
- **Fields:** `fieldStyles`, with a visible label and the error text associated with the field.
- **Tables (target, phase 5: `DataTable`):** 40px rows, 32px compact; numbers right-aligned with
  matching headers and nothing centred; fixed decimals per column; a sticky header past one screen
  and a sticky identity column on sideways scroll; a visible overflow cue; hairline rules (stripes
  only on the full player-stats table); abbreviated headers in `<abbr title="…">`; default sort by
  the most important value; leaders marked by a tint or marker, not bold.
- **Numbers, empty states, loading, dialogs (target, phase 5):** `StatValue`, `EmptyState`, one
  `Spinner` and `Skeleton`, and a `ConfirmDialog` whose props carry the destructive-copy rules.
- **Charts:** change over time as lines, the focus series emphasised and context in grey, labelled
  directly. Provisional segments dashed and labelled. Club identity as a chip with the abbreviation,
  never hue alone.

### Club colours

`src/lib/clubGuernseys.ts` is the source. Club colour appears as stripes, chips, guernsey sketches and
single-club accents, never as a large fill behind body text, and always with the club name or
abbreviation. Text on a club colour is black or white, whichever contrasts more; a unit test checks
all 18 clubs on every surface (target, phase 2).

## Content

### Voice

- **Plain:** say what happened in the reader's words.
- **Exact:** numbers, names, dates and what actually persisted. Never inflate.
- **Footy-literate:** the game's terms used correctly; dry, not jokey.

Two registers. The fantasy app is peer to peer: contractions are fine, and dry humour only in success
and social moments, never in errors, FAAB or destructive flows. The public outcomes site is a
reference: neutral, third person, no humour. Prefer "cannot" and "did not" in errors and on the
outcomes site.

### Mechanics

Australian English, following the Australian Government Style Manual.

| Topic    | Rule                                                                                        | Example                   |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| Casing   | Sentence case for headings, buttons, tabs, titles and legal pages; no full stop on headings | "Team settings"           |
| Spelling | Australian English in user-facing strings                                                   | realised, centre, defence |
| Dates    | Day month year, no ordinals, no comma after the weekday                                     | "Saturday 22 March 2025"  |
| Times    | Lower-case am or pm after a non-breaking space; zone on every deadline; midday, midnight    | "6 am AEDT"               |
| Ranges   | "to" in prose; an unspaced en dash in headers and axes; never a slash                       | "2021 to 2025", "2021–25" |
| Numbers  | Words for zero and one, numerals from 2; thousands separator; % in UI, "per cent" in prose  | "1,240", "62%"            |
| Stats    | Abbreviations from the one Statly table, rendered with `<abbr>`, expanded on first use      | "I50" for inside 50s      |

### Copy patterns

- **Errors:** what failed, what is still true, what to do. "League not created. Nothing was saved.
  Check your connection and try again." Problems the user cannot fix use a service-unavailable
  message instead.
- **Success:** state the persisted fact. "Waiver claim saved. It runs at 6 am AEDT on Wednesday 19
  November."
- **Empty states:** why the view is empty, plus one next action.
- **Loading:** name the thing loading.
- **Destructive dialogs:** ask the question, state the consequence and whether it can be undone, and
  label the button with the verb ("Remove member", never "OK").
- **Buttons:** start with a verb and name the object.

### Trade pages and published facts

- Every comparison states its basis: realised value over each player's first stint at the new club,
  linked to the methodology page.
- "Provisional" is a visible state with a reason and an as-of date, not scattered hedge words.
- Every table carries a source and reviewed-on line. Superlatives only over a stated population.
- Corrections are visible and dated: what changed, why, when.

### Banned words

- Hype: unlock, unleash, elevate, empower, seamless, effortless, robust, leverage, harness,
  supercharge, game-changer, cutting-edge, delve, pivotal, crucial, "dive in", "not just X, but Y".
- System-message tics: oops, please, sorry, successfully, invalid, exclamation marks.
- Verdict overclaims: fleeced, robbery, heist, steal, masterstroke, disaster.

## Enforcement

Rules an agent reads are the first layer; tests are the backstop. Phases land in order.

| Phase                 | Ships                                                                                                                                                                                                                | Status  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1. Write the rules    | This guide, linked from `AGENTS.md` and [design principles](design-principles.md)                                                                                                                                    | Done    |
| 2. Freeze drift       | `Scripts/design/count-raw-colours.mjs` grows into a drift counter with a committed baseline that CI fails on any rise; `@axe-core/playwright` with the `wcag22aa` tag; contrast unit test over token pairs and clubs | Planned |
| 3. Restructure tokens | Primitives and semantic tiers, `--input` at 3:1 or more, `text-label`, one accent, paper surface mode, dead dark code removed. `src/index.css` is over 300 lines, so it needs an approved edit plan                  | Planned |
| 4. Lint gates         | `eslint-plugin-better-tailwindcss` (after a spike), Tailwind's default palette removed once raw colours reach zero, cspell with Australian English, Vale on docs                                                     | Planned |
| 5. Consolidate        | `DataTable`, `StatValue`, `EmptyState`, one spinner, buttons on `buttonStyles`, a shared formatter, copy rewrites, one logo source                                                                                   | Planned |
| 6. Living style guide | A gated `/styleguide` route rendering every token and primitive, with axe and screenshot checks; screenshot baselines generated in CI only                                                                           | Planned |

Today the only automated design check is `tests/unit/designTokenColours.test.ts`, which keeps a list of
cleaned files free of raw colours. `node Scripts/design/count-raw-colours.mjs --top 15` lists what is
left.

# Style guide

The rules every Statly screen follows, on both the fantasy app and the public AFL Draft and Trade
Outcomes site. [Design principles](design-principles.md) says what good looks like; this guide is the
reference: owner decisions, brand, tokens, type, shape, components and copy. Where a rule is marked
**target**, new code follows it now and existing code moves to it in the phase named under
[Enforcement](#enforcement). Rules with no marker are already how the code works.

The brand below (cobalt, sun, the Marker controls) was approved by the owner on 2026-11-20 from the
Statly design system page, version 5. That page shows every rule as specimens and real screens; this
guide is the written source of truth, and where the two disagree this guide wins.

Agents: read the [Rules for agents](#rules-for-agents) section before touching UI or user-facing
strings.

## Rules for agents

- MUST use semantic token utilities (`bg-background`, `text-muted-foreground`, `border-input`). NEVER
  palette classes (`text-gray-500`, `bg-blue-600`), hex in `className` or `style`, or a new area
  palette. NEVER hand-roll the cobalt or sun hex values or read a `--brand-*` primitive in a
  component; use the semantic roles (`bg-primary`, `text-secondary-foreground`).
- MUST use `buttonStyles`, `badgeStyles` and `fieldStyles` from `src/components/ui/controlStyles.ts`.
  NEVER a bare styled `<button>`, `src/components/Button.tsx` or `ui/Badge.tsx` in new code.
- MUST use the three brand typefaces in their roles: Geist for display and UI, Saira for reading,
  Caveat for hand notes (`font-display`, `font-sans`, `font-hand`). NEVER load
  another font outside the story collage exception. NEVER set text below 11px.
- MUST write sentence case, Australian English, and the copy patterns under [Content](#content).
  NEVER "successfully", "please", "sorry", "oops", an exclamation mark in system messages, or any
  pattern under [Patterns that read as machine-written](#patterns-that-read-as-machine-written).
- MUST format dates, times and numbers with an explicit `en-AU` locale; league times go through
  `formatLeagueTime`. NEVER a bare `toLocaleString()`.
- MUST give every status a word or letter as well as a colour (W, L, D, Live, Provisional).
- MUST keep keyboard access, a visible focus ring, accessible names, 44px touch targets on phones and
  390px reflow.
- NEVER add a dark theme or `dark:` utilities.

## Owner decisions

Recorded 2026-11-19 from the style guide research, and 2026-11-20 for the brand, unless another date
is given.

| Topic                             | Decision                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme                             | Light only. The `.dark` tokens and `dark:` utilities are deleted (done).                                                                                                                                                                                                                                                                                                                   |
| Brand colour                      | Cobalt `#1a2cff` replaces navy `#0f2a44` everywhere (2026-11-19). It is also the only accent: `#185fa5` is gone and `text-blue-700` is gone from the public layout. The `--statly-navy` and `--statly-blue` aliases were deleted in ticket 11 (2026-11-22).                                                                                                                                |
| Warm accent                       | Sun `#ffc247`: your turn, deadlines, selection and highlights. Always ink text on sun (2026-11-20).                                                                                                                                                                                                                                                                                        |
| Typefaces                         | Geist for display and UI, Saira for reading and table numbers, Caveat for hand notes, on both surfaces (2026-11-19, replacing Saira Extra Condensed).                                                                                                                                                                                                                                      |
| Controls                          | The Marker direction (2026-11-20): hand-drawn icons, hand-cut edges on anything pressed or floating, torn-tape badges. Pages, tiles and tables stay square.                                                                                                                                                                                                                                |
| Logo                              | The lowercase "statly" wordmark with the hand-drawn Sherrin tilted −14°, resting on the tip of the y. One source, `StatlyWordmark` (bar, masthead, and the sign-in lockup: ink word, cobalt ball filled white); the favicon and home-screen icon are the Sherrin alone, white on a cobalt square. The old PNG logos are deleted (2026-11-22).                                              |
| Sport family                      | Basketball and soccer balls in the same hand-drawn style stand in for the Sherrin on those sports' surfaces.                                                                                                                                                                                                                                                                               |
| Warm trade palette                | Kept as an official surface mode, `data-surface="paper"`, replacing the `--ts-*` namespace (done 2026-11-20).                                                                                                                                                                                                                                                                              |
| Trade verdicts                    | Public trade pages show values, not letter grades or verdict labels (as built for #789).                                                                                                                                                                                                                                                                                                   |
| Two sides                         | One side cobalt, the other ink, on card edges, chart lines and bars alike. Never good and bad colours.                                                                                                                                                                                                                                                                                     |
| Match results                     | Win solid (cobalt on light grounds), loss outlined in ink, draw stone, always with W, L or D. Never green and red.                                                                                                                                                                                                                                                                         |
| Club colours                      | Only in the 13px club square beside the abbreviation. Never stripes, card edges, page-head blocks or large fills. The My Team field is an illustration exception (2026-11-21); text is never set on a club colour there either.                                                                                                                                                            |
| Imagery                           | Licensed black-and-white photo cutouts plus the hand marks. No generated people outside the story collage exception.                                                                                                                                                                                                                                                                       |
| Story collage                     | Permanent exception, scoped to the home hero and `/afl/stories` (owner, 2026-11-16). Paper, ink and grey text use the brand tokens; its art colours (newsprint, stamp red, tape, notebook rule, sky, slips, club orange and navy) are named once at the top of `storyCollage.css`, the hero's ticket stub once in `marketHero.css`, and both sheets are counted like any other stylesheet. |
| Time zones and stat abbreviations | AEST or AEDT by date, as `formatLeagueTime` prints. One Statly abbreviation table beside `src/types/fantasyCategories.ts` (phase 5).                                                                                                                                                                                                                                                       |

## Brand

### Colour

Six colours, each with one job. Ratios are WCAG 2.2 contrast ratios against white unless stated.

| Name   | Hex       | Job                                                                    | Text on it                               |
| ------ | --------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| Cobalt | `#1a2cff` | The brand: primary actions, links, current place, one side of a trade  | White (7.37:1)                           |
| Ink    | `#111111` | Text, the other side of a trade, the hard shadow, dark feature grounds | White; sun for the accent                |
| Stone  | `#e8e6e1` | Page sheet, quiet panels, outage alerts, draws                         | Ink; cobalt is 5.91:1                    |
| White  | `#ffffff` | Reading ground, cards, inputs                                          | Ink                                      |
| Tint   | `#d9ddff` | Provisional, info alerts, table leaders                                | Ink; deep cobalt `#1220c9`               |
| Sun    | `#ffc247` | Yours and now: your pick, deadlines, selection, highlighter            | Ink only (11.7:1). Never white or cobalt |

Supporting values: secondary text `#55534e`, hairline `#c9c5bc`, red `#c81e1e` for live, errors and
destructive actions only, and amber `#7a4a06` (`text-warning-text`) for warning words. Sun is a fill:
`bg-warning` with `text-warning-foreground`. NEVER `text-warning`; sun text is 1.6:1 on white. Words
that must hold on stone and tint at the 5.5:1 small-label rule use their own text roles: red words
`#a81919` (`text-destructive-text`, 5.97 on stone; the destructive button fill stays `#c81e1e`, while live and league danger use `#a81919` as both words and fill) and success
`#0e5a2b` (6.69 on stone).

Stone is the quiet ground (`--muted`, done 2026-11-21): page sheets, table heads, hovers on white
cards and the draft room page. A form field is never stone: it stays `bg-field` white, because a
stone field reads as disabled.

### Grounds

Every tile, card or band sits on one of six grounds (white, stone, tint, cobalt, ink, sun), and the
ground sets the colours of everything on it: text, secondary text, rules, marks, the primary action,
focus, win and provisional. Components read those roles, so a button or badge is correct on any ground
by construction. The `.ground-white`, `.ground-stone`, `.ground-tint`, `.ground-cobalt`, `.ground-ink`
and `.ground-sun` classes in `src/index.css` do this (done 2026-11-20); surfaces move onto them screen by
screen. Only the core roles follow a ground: aliases such as `--brand-bar` keep their root values.
A card inside a cobalt, ink or sun ground carries `.ground-white`.

The public trade pages and the front page sit on the paper surface mode (`data-surface="paper"`,
done 2026-11-20): a warm page `#fbfaf7` (`--brand-paper`) with quiet panels `#f1efe8`
(`--brand-paper-deep`). It redefines only `--background` and `--muted`; ink, secondary text, cobalt,
white cards, the hairline and focus keep their root values. Every net figure on those pages is ink.
A two-club value line draws its sides cobalt (the club first by name) and ink, never by who leads;
a trade of three or four clubs keeps guernsey lines (owner, 2026-11-20; done 2026-11-21). The story collage inside it keeps its own grounds.

- On cobalt and ink, the primary action is sun with ink text; marks are white on cobalt and sun on
  ink.
- Cobalt never touches cobalt, and sun never sits next to tint.
- One sun moment per screen: a second sun area means neither reads as "yours".

### Graphic language

Quick hand-drawn marker marks, a 3px line: loop, underline, arrow, tally, asterisk, goalposts, tick,
strike and burst. Cobalt on light grounds, white or sun on cobalt, sun on ink, cobalt on sun.

- A mark points at, circles or counts something real. Brand surfaces may use three; app screens one.
- Marks never cross the digits, words or drawing they decorate: a loop clears its subject by at least
  6px across and 4px up and down; rays start outside the ball.
- Marks are never red, and never decorate empty space.

### Cartoons

The Sherrin cartoon has six moods: thinking (empty lists), happy (league made, claim won), running
(loading over a second), confused (errors), sleepy with the sun (off-season) and celebrating with a sun
burst (draft done, premiership). Cartoons live in empty, loading, error and celebration states only,
96–128px, one per view.

## Tokens

All tokens live in `src/index.css` (Tailwind v4, `@theme inline`, no JavaScript config).

- **Two tiers.** Primitives (raw values) live in plain `:root` and generate no utilities. Semantic roles
  (`--background`, `--foreground`, `--muted-foreground`, `--input`, `--primary`, `--ring`,
  `--result-win`, `--status-live` and so on) are the only names components use, exposed through
  `@theme inline`.
- **Brand primitives.** `--brand-cobalt`, `--brand-cobalt-deep`, `--brand-tint`, `--brand-sun`,
  `--brand-ink`, `--brand-stone`, `--brand-secondary-text`, `--brand-hairline`, `--brand-red` and the
  paper pair `--brand-paper` and `--brand-paper-deep` (done
  2026-11-20), plus the shape tokens under [Shape](#space-shape-elevation-motion-and-focus): the
  hand-cut `--radius-cut` and the floating cut `--radius-cut-float` with the hard shadows
  `--shadow-hard` and `--shadow-hard-cobalt` (done 2026-11-20).
- **Field roles.** `--field`, `--field-foreground` and `--field-placeholder` keep a field white with
  ink text on every ground; no ground redefines them (done 2026-11-20).
- **Grounds and surface modes, not namespaces.** A ground or the paper mode redefines the semantic
  roles on its root element; components inside it use the same utilities as everywhere else.
- **Area palettes collapse (phase 3).** An area token (`--league-*`, `--social-*`, `--trade-*`, `--draft-broadcast-*`) that only
  aliases a core role is deleted and its call sites use the core utility. The league palette went first (ticket 08,
  2026-11-22): its soft status fills are now the semantic roles `--success-soft`, `--warning-soft` and
  `--destructive-soft` (fills behind status words), and its button hover is `--brand-bar-hover`. The social palette followed (ticket 09): your own chat
  messages sit on the cobalt ground, so their quiet words and focus ring come from the ground. The trade centre palette went
  third (ticket 10a) and the draft room last (ticket 10b): the draft page is a stone ground and its
  panels white grounds, so no area palette is left. Tokens with a recorded reason stay and are registered in `@theme`.
- **No JSON token pipeline.** The CSS file is the only source. Revisit only if a second consumer
  (native app, Figma, generated images) needs the values.

### Colour roles

Every pair below must hold on every ground and surface mode.

| Role                    | Rule                                                                   | Status                                                                                          |
| ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Body text               | At least 4.5:1                                                         | Ink on white is 18.9:1                                                                          |
| Small labels (11–12px)  | At least 5.5:1                                                         | Secondary, success, red and amber words hold 5.5 on white, stone and tint (done 2026-11-21)     |
| `--input` (field edge)  | At least 3:1 against its surface (WCAG 1.4.11)                         | A 2px ink edge, 18.9:1 on white (done 2026-11-20)                                               |
| `--border` (decorative) | No minimum; never the only edge of a control                           | Hairline `#c9c5bc`                                                                              |
| Brand and links         | Cobalt on light grounds; white on cobalt; sun on ink                   | Cobalt on light grounds done; other grounds phase 3                                             |
| Results                 | Win solid, loss outlined, draw stone, always with W, L or D            | Done 2026-11-20: `resultTone` in `controlStyles.ts`; errors and success never use result tokens |
| Live                    | `--status-live` red, always with the word "Live", never a result token | Exists                                                                                          |
| Provisional             | Tint, always with the word "Provisional"                               | Target, phase 3                                                                                 |
| Trade sides             | Cobalt and ink, never good/bad colours                                 | Fantasy trade centre 2026-11-20; public two-club value line 2026-11-21                          |
| Selection               | Sun with ink text; ink with white text on a sun ground                 | Done                                                                                            |

A trade has two sides, not a good side and a bad side: trade charts never use green and red.

### Type

| Role        | Face and setting                                                   |
| ----------- | ------------------------------------------------------------------ |
| Display     | Geist 900, tight tracking (−0.05em), line height 0.9 when it wraps |
| Big numbers | Geist 900 at 28px and up; a spaced en dash in scores ("6–3")       |
| UI          | Geist 600–800: buttons, labels, tabs, names, badges                |
| Label       | Geist 700, 11px, uppercase, 0.1em tracking                         |
| Reading     | Saira 400–600 for sentences, captions, alerts and table numbers    |
| Hand note   | Caveat 700, one short line, 22px or larger, one per view           |

- Brand surfaces (masthead, posters, social, public site hero) set display lines lowercase with a full
  stop. In-app screen headings, section titles and tile headings are sentence case with no full stop.
- `body` sets tabular numerals; table numbers are right-aligned Saira, never centred.
- `uppercase` only on labels and badges, never on navigation or group headings.
- No display line leaves one word alone on its last line.

### Space, shape, elevation, motion and focus

- **Spacing:** the 4px scale only: 4, 8, 12, 16, 24, 32, 48, 64, 96. Tiles and cards pad 24 on desktop
  and 16 on phones. Label to content is 16; a second group inside one tile starts 32 below the first.
  Space inside a group is always smaller than space between groups. Layout constants are named `:root`
  tokens.
- **Shape:** the page is square, like a scoreboard: tiles, cards, tables, alerts and photos have no
  radius. Anything you press or that floats (buttons, inputs, chips, toggles, pagination, menus,
  dialogs, sheets, toasts, tooltips) has the one shared hand-cut edge, a set of asymmetric radii:
  `rounded-cut` on buttons and fields, `rounded-cut-float` on menus, dialogs, popovers, toasts and
  tooltips through `floatingStyles` (done 2026-11-20); chips and toggles move screen by screen.
  Never a neat rounded corner or a pill. The fantasy app's core pages are square (done 2026-11-21,
  ticket 07). The public draft, methodology and AFL index route files and the shared draft hub components
  (`draftHubChrome.ts`, `DraftHubNav`, `DraftHubState`, the explorers, the clubs directory, the club
  history and the trade detail) are square (ticket 07p, 2026-11-22). The league and social pages are square (tickets 08 and 09, 2026-11-22); the chat
  launcher, chat panel, drawer and menus have the cut edge and the hard shadow. The trade centre
  and draft room are square too (tickets 10a and 10b).
- **Lines:** each weight means one thing. Hairline for separation; 2.5px ink for buttons and floating
  things; 2px ink for inputs and chips; 1.5px ink under table headers; 3px for the current tab; a 4px
  top edge for which side; a 6px sun left edge for "yours", the only side stripe allowed; 2px dashed
  cobalt for "not there yet" (empty slot, disabled); a red outline only on an error alert.
- **Elevation:** everything on the page is flat. Floating things cast one hard shadow, never blurred:
  5px 6px ink on light floating things, cobalt under ink ones (toasts, tooltips) (done 2026-11-20:
  `shadow-hard`, `shadow-hard-cobalt`). Dialogs sit on a 60% ink scrim (`bg-overlay`). Tooltips
  have no caret: the cut edge has no straight side for one.
- **Badges:** torn tape, sitting about one degree off straight, never more than two (done
  2026-11-20: the `tape` utility, alternating direction between sibling badges).
- **Motion:** buttons tilt 1.5° and grow 3% on hover and squash to 95% when pressed, all under
  `motion-safe:`, and never when disabled (done 2026-11-20 in `buttonStyles`). The global
  reduced-motion rule and `MotionConfig` stay. Never flash, pulse or shake a clock.
- **Focus:** a 3px dashed ring, 4px out, in the ground's focus colour (cobalt on light grounds, white
  on cobalt, sun on ink, ink on sun) (done 2026-11-20 in the control and floating recipes; the
  rest moves screen by screen). Sticky headers set
  `scroll-padding-top` so focus is never hidden behind them.
- **Targets:** at least 24px; 44px for every phone control, including the app nav.

### Icons

One hand-drawn marker set on a 24px grid: a 2.2px line with round ends and the shared slight wobble,
one colour, outline only (target, phase 5: the `StatlyIcon` glyphs are redrawn). Sizes are 16 inline,
20 in buttons and 24 in navigation, inside a 44px tap area. Icons label things and never carry meaning
alone; pair them with words in navigation and primary buttons. No stock icon sets, filled or duotone
icons, emoji, or club and AFL logos as icons.

## Components

One primitive per job, in `src/components/ui/`.

- **Buttons:** `buttonStyles` only. Verb first and naming the object ("Save lineup", "Remove member").
  One primary per view, first in its row and left-aligned. Primary is cobalt on light grounds and sun
  on cobalt and ink; destructive is red and always confirmed in a dialog. 44px tall; the 32px small
  size only inside dense rows (tables, lists, save bars). Disabled buttons are dashed and sit beside
  their reason; a link styled as a button is disabled with `aria-disabled`. Icon-only buttons need an
  accessible name. Hand-cut, 2.5px ink edge (2px at the small sizes) and the dashed focus ring are
  done (2026-11-20); the remaining bare `<button>`s move onto the recipe screen by screen.
- **Badges:** `badgeStyles` only, torn tape, always a word or letter. Three per row at most. Labels
  are uppercase 11px; a badge holding a name, a query or someone's own words passes `caps: false`
  (done 2026-11-20).
- **Chips and segmented controls:** `chipStyles`: hand-cut with a 2px ink edge, turning sun when
  picked (done 2026-11-20 on the public trade pages; the rest move screen by screen).
- **Fields:** `fieldStyles`, white with a 2px ink edge on every ground (done 2026-11-20), label
  above, hint or error below with the error associated with the field. Errors keep what was typed.
  `border-input` is the field edge only; any other edge uses `border-border`.
- **Menus, dialogs, sheets, toasts, tooltips:** hand-cut with the hard shadow, through
  `floatingStyles` (light: white with a 2.5px ink edge; ink: toasts and tooltips). Menu rows use
  `menuItemStyles`: the current row gets the sun highlighter swipe (`highlighter`), the pointer or
  keyboard position a quiet fill and an inset dashed outline. Dialog buttons are `buttonStyles`,
  primary first; a destructive confirm opens on Cancel (done 2026-11-20 in the `ui/` primitives,
  the toast and the core-token menus; area menus move with their palettes). Destructive choices
  never live in a toast or a menu without a dialog.
- **Alerts:** a ground, not a stripe: tint for info, sun for a deadline, white with a red outline for
  an error, stone for an outage; success is white with a hairline and says so in words. Text stays
  ink. `alertStyles` in `controlStyles.ts` sets the ground; `ui/Alert.tsx` uses it, and a queued
  alert floats with the floating cut and hard shadow (done 2026-11-21 outside the area palettes).
- **Navigation:** the app bar and the public header are both cobalt with the Sherrin wordmark and
  white tabs (owner, 2026-11-21: the public site wears the same bar as the app). The current place is a 3px underline plus heavier type. Tabs scroll sideways
  on phones with a fade at the edge.
- **Cards:** one card, one thing, square and flat. Edges say whose: a 4px top edge for a side, the 6px
  sun left edge for yours.
- **Tables (target, phase 5: `DataTable`):** 44px rows, 32px compact on desktop; numbers
  right-aligned in Saira with matching headers and nothing centred (done 2026-11-21 for the ladder,
  the standings race and the matchup score column); fixed decimals per column; a
  sticky header past one screen and a sticky identity column on sideways scroll; a visible overflow
  cue; hairline rules, never stripes; abbreviated headers in `<abbr title="…">`; default sort by the
  most important value; leaders tinted, not bold; your row on sun.
- **Numbers, empty states, loading, dialogs (target, phase 5):** `StatValue`, `EmptyState` (one
  sentence, one way forward, a cartoon), one `Spinner` and `Skeleton`, and a `ConfirmDialog` whose
  props carry the destructive-copy rules.
- **Charts:** two series at most, cobalt and ink, labelled directly; a key only for two-series bars.
  Sun marks the moment that matters; tint and a dashed line mark what is still provisional, with the
  word. Club identity as the club square and abbreviation, never hue alone. Fantasy charts (standings
  race, category bars, trade centre) done 2026-11-20; the public value-line chart waits on the owner's
  call on trades with more than two clubs.

### Club colours

`src/lib/clubGuernseys.ts` is the source. Club colour appears only in the 13px club square, always
beside the club abbreviation. The square shows both guernsey colours split on the diagonal, main
colour top left, inside a 1px ink edge (owner, 2026-11-22), so the black clubs (Essendon, Richmond,
Port Adelaide, Collingwood) tell apart; white guernseys (Geelong, North, Sydney) lead with their
trim. `clubSquareBackground` gives the CSS. Text is never set on a club colour. A unit test checks
the squares against every ground (target, phase 2). On the public trade pages `ClubBadge` draws the
square and abbreviation, the trade tree is ink with a club square beside each club's name (done
2026-11-20), and the home page trade ladder uses the same square. The trade page head and the scarf
still use club colours: the owner is redesigning them (ticket 06h), so they carry `data-collage` and
the brand check skips them, like the story collage on the home page.

In the fantasy app the My Team squad list and player search show `ClubSquare` (the square and the
abbreviation, no club logo). **Exception (owner, 2026-11-21):** the My Team field is an
illustration: its guernseys wear club colours. It carries `data-illustration`, and the brand check
lets club colour through there and lets its decorative (`aria-hidden`) drawing be round. It still
fails an element whose own text sits on its own club-colour fill; text in a child of a filled
shape is not caught yet, so check that by eye. Every other rule applies inside it.

**Exception (owner, 2026-11-21):** the Google and Facebook marks on the sign-in buttons keep their
owners' colours, as their sign-in rules require. They carry `data-provider-logo`, and the brand
check skips only those marks, not the buttons around them.

## Content

### Voice

Say what happened in the reader's words. State numbers, names and dates exactly, and report only
what persisted. Use the game's terms correctly; any humour is dry.

The fantasy app and the public outcomes site use different registers. The fantasy app is peer to
peer: contractions are fine, and dry humour belongs only in success and social moments, never in
errors, FAAB or destructive flows. The public outcomes site is a
reference: neutral, third person, no humour. Prefer "cannot" and "did not" in errors and on the
outcomes site.

### Mechanics

Australian English, following the Australian Government Style Manual.

| Topic    | Rule                                                                                        | Example                   |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| Casing   | Sentence case for headings, buttons, tabs, titles and legal pages; no full stop on headings | "Team settings"           |
| Spelling | Australian English in user-facing strings                                                   | realised, centre, defence |
| Dates    | Day month year, no ordinals, no comma after the weekday; the weekday must match the date    | "Saturday 21 March 2026"  |
| Times    | Lower-case am or pm after a non-breaking space; zone on every deadline; midday, midnight    | "6 am AEDT"               |
| Ranges   | "to" in prose; an unspaced en dash in headers and axes; never a slash                       | "2021 to 2025", "2021–25" |
| Numbers  | Words for zero and one, numerals from 2; thousands separator; % in UI, "per cent" in prose  | "1,240", "62%"            |
| Stats    | Abbreviations from the one Statly table, rendered with `<abbr>`, expanded on first use      | "I50" for inside 50s      |

A list of times may carry one "Times in AEST" note instead of a zone on every row.

### Copy patterns

- **Errors:** what failed, what is still true, what to do. "League not created. Nothing was saved.
  Check your connection and try again." For an outage the user cannot fix, name what is down and what
  it blocks, and promise no fix time: "Waivers are down, so your claim was not saved. Try again in a
  few minutes." On the outcomes site: "Trade records are unavailable. This page cannot load until
  they are back."
- **Success:** state the persisted fact. "Waiver claim saved. It runs at 6 am AEST on Wednesday 17
  June."
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
  supercharge, game-changer, cutting-edge, delve, pivotal, crucial, journey, embark, landscape,
  testament, underscore, streamline, comprehensive, actionable, "dive in".
- Filler phrases: "it's worth noting", "at its core", "when it comes to", "here's the thing",
  "the numbers speak for themselves", "the data tells a story", "key" as a filler adjective,
  "quietly" for drama.
- System-message tics: oops, please, sorry, successfully, invalid, exclamation marks.
- Verdict overclaims: fleeced, robbery, heist, steal, masterstroke, disaster.

### Patterns that read as machine-written

Swapping words is the weakest fix; generated copy mostly shows in its sentence shape. Check every
heading, empty state and story paragraph for these:

- **Contrast set-ups:** "not X, but Y", "X, not Y" and "it's not X, it's Y" when nobody suggested X.
  State Y. A correction ("Pick 23, not 32") stays.
- **Groups of three:** three adjectives or three matching clauses added for rhythm. List only the
  items the meaning needs.
- **Colon reveals:** "The result: a top-ten pick." Write it as a plain sentence.
- **Slogan headings:** two or three clipped sentences ("Trade. Compare. Win."). Headings are noun
  labels for the content: "Trade history", "Club totals".
- **Things that speak:** numbers that "tell a story", pages that "decide". Say what the figure shows
  or what the code does.
- **Commentary on the copy:** "This matters", "As you can see", "Here's what you need to know".
  Delete it, or put the fact there.
- **Kicker endings:** a closing maxim or metaphor. End on the last concrete sentence.
- **Em dashes:** none in UI strings. Use a full stop, colon or comma. En dashes stay for ranges.
- **Vague claims:** "better value", "a big win". Give the number and its basis, or cut the claim.

Portability test: if a sentence would still fit on another product's page, replace it with a fact
that holds only for Statly, or delete it.

## Enforcement

Rules an agent reads are the first layer; tests are the backstop. Phases land in order.

| Phase                 | Ships                                                                                                                                                                                                                                                                                                                                                                                         | Status      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. Write the rules    | This guide, linked from `AGENTS.md` and [design principles](design-principles.md); the cobalt brand and Marker controls written in on 2026-11-20                                                                                                                                                                                                                                              | Done        |
| 2. Freeze drift       | `Scripts/design/raw-colour-baseline.json` holds each file's raw-colour count and `tests/unit/designTokenColours.test.ts` fails on any rise; `tests/unit/designContrast.test.ts` checks the core token pairs and the club squares on the light grounds. `@axe-core/playwright` (`tests/e2e/helpers/axe.ts`, WCAG 2.0 to 2.2 A and AA tags) runs on every page the brand e2e audits (ticket 11) | Done        |
| 3. Restructure tokens | Primitives and semantic tiers, the brand colours and six grounds, Geist and Caveat, the control cut, tape, field roles and `--input` at 3:1 or more (done 2026-11-20), the floating cut and hard shadow tokens (done 2026-11-20), paper surface mode (done 2026-11-20; dead dark code removed 2026-11-20). `src/index.css` is over 300 lines, so it needs an approved edit plan               | In progress |
| 4. Lint gates         | `eslint-plugin-better-tailwindcss` (after a spike), Tailwind's default palette removed once raw colours reach zero, cspell with Australian English (done 2026-11-24; Vale cut)                                                                                                                                                                                                                | Planned     |
| 5. Consolidate        | `DataTable`, `StatValue`, `EmptyState`, one spinner, buttons on `buttonStyles`, the redrawn marker icon set, a shared formatter, copy rewrites, one logo source                                                                                                                                                                                                                               | Planned     |
| 6. Living style guide | `/dev/styleguide` (development tools only; the not-found page otherwise) renders every colour token, the grounds and the control recipes; the brand audit and axe run on it in `tests/e2e/styleguide.test.ts` (done 2026-11-24). Screenshot baselines are a separate ticket if wanted                                                                                                         | Done        |

Automated design checks today:

- `tests/unit/designTokenColours.test.ts` keeps a list of cleaned files free of raw colours, and fails
  when any file holds more raw colours than `Scripts/design/raw-colour-baseline.json` allows (a new
  file is allowed none). Component stylesheets are counted too; only `src/index.css`, where the
  tokens are defined, is skipped. After a clean-up, lower the baseline with
  `node Scripts/design/count-raw-colours.mjs --write-baseline`; never raise it.
  `node Scripts/design/count-raw-colours.mjs --top 15` lists what is left.
- `npm run spell` (CI's Docs job) runs cspell from `cspell.config.yaml`. In `src/**/*.tsx` it reads
  only what a reader sees, text between JSX tags and quoted strings with a space in them, in
  Australian English, so `Randomize` or `finalized` in copy fails. Docs get a typo check that also
  accepts US spellings, because they name US-spelt code. A correct word cspell does not know goes in
  `cspell-words.txt`; a US spelling in copy gets fixed, not listed.
- `tests/unit/designContrast.test.ts` checks the core token pairs that exist today (see [Colour roles](#colour-roles))
  against the values in `src/index.css`, the six grounds and the paper surface, and each club square
  against the light grounds and paper. `designTokenColours.test.ts` also fails if the retired `--ts-*`
  trade palette comes back. Add a pair when a token gains a job.
- `tests/e2e/public-trades-brand.test.ts` loads the front page, the trade list, a trade, a club's
  chains and the method page at 1280, 1024, 768 and 390px and fails on a pill, a rounded tile or list, a
  blurred shadow, red outside live and errors, text under 11px or under 4.5:1, a Geist sentence, a
  side stripe, or club colour bigger than the 13px square. It skips `[data-collage]`. The rules live
  in `tests/e2e/helpers/brandAudit.ts`; a radius above 2px on a tile, card or table counts.
- `tests/e2e/app-brand.test.ts` runs the same audit, signed in, on the dashboard, a league overview,
  My Team, standings, matchups, waivers, the players list, a player page and the three social views,
  the trades tab and the draft room at 1280 and 390px, on the open chat panel and trade composer, and on the sign-in page,
  skipping nothing.
